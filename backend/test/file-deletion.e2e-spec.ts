import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { FileState } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Real integration: Postgres + MinIO from docker-compose, no mocks
// Dispatch logic and races (P2025, NoSuchUpload) are already covered in isolation by
// file-deletion.service.spec.ts; this checks the server contract end to end.
describe('File deletion (e2e)', () => {
  // `ready` files go through the scan worker (separate container); Jest's
  // default 5s timeout is too short.
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let internalS3: S3Client;
  let token: string;
  let otherToken: string;
  const createdFileIds: string[] = [];

  async function registerAndLogin(prefix: string): Promise<string> {
    const email = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'testpass123' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'testpass123' })
      .expect(200);
    return (login.body as { token: string }).token;
  }

  async function initiateUpload(
    authToken: string,
  ): Promise<{ fileId: string; storageKey: string; uploadId: string }> {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        originalName: 'delete-e2e.txt',
        mimeType: 'text/plain',
        sizeBytes: 13,
      })
      .expect(201);

    const body = initiate.body as { fileId: string };
    createdFileIds.push(body.fileId);
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });
    return {
      fileId: body.fileId,
      storageKey: file.storageKey!,
      uploadId: file.uploadId!,
    };
  }

  async function uploadReadyFile(
    authToken: string,
  ): Promise<{ fileId: string; storageKey: string }> {
    const { fileId, storageKey, uploadId } = await initiateUpload(authToken);

    const putResult = await internalS3.send(
      new UploadPartCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storageKey,
        UploadId: uploadId,
        PartNumber: 1,
        Body: Buffer.from('hello world!!'),
      }),
    );

    await request(app.getHttpServer())
      .post(`/files/uploads/${fileId}/complete`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ parts: [{ partNumber: 1, etag: putResult.ETag }] })
      .expect(200);

    const ready = await waitForReady(fileId);
    return { fileId: ready.id, storageKey: ready.storageKey! };
  }

  async function waitForReady(fileId: string) {
    for (let attempt = 0; attempt < 60; attempt++) {
      const file = await prisma.file.findUniqueOrThrow({
        where: { id: fileId },
      });
      if (file.state === FileState.ready) {
        return file;
      }
      if (file.state === FileState.rejected) {
        throw new Error(`File ${fileId} was rejected by the scan worker`);
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `File ${fileId} never reached ready (is the worker container running?)`,
    );
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    internalS3 = new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    });

    token = await registerAndLogin('delete-e2e');
    otherToken = await registerAndLogin('delete-e2e-other');
  });

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    await app.close();
  });

  it('rejects an unauthenticated request', async () => {
    const { fileId } = await uploadReadyFile(token);

    await request(app.getHttpServer()).delete(`/files/${fileId}`).expect(401);
  });

  it('returns 404 for a well-formed but unknown file id', async () => {
    await request(app.getHttpServer())
      .delete('/files/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('returns 400 for a malformed id instead of leaking a 500 from Prisma', async () => {
    // `id` is a UUID column: without ParseUUIDPipe, a non-UUID string would
    // fail inside Prisma (P2023) before the existence check ever runs.
    await request(app.getHttpServer())
      .delete('/files/does-not-exist')
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('returns 404 for a file owned by another user, and leaves it untouched', async () => {
    const { fileId } = await uploadReadyFile(token);

    await request(app.getHttpServer())
      .delete(`/files/${fileId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);

    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeTruthy();
  });

  it('deletes the row and the underlying object for a ready file', async () => {
    const { fileId, storageKey } = await uploadReadyFile(token);

    await request(app.getHttpServer())
      .delete(`/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();

    await expect(
      internalS3.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: storageKey,
        }),
      ),
    ).rejects.toThrow();
  });

  it('aborts the in-flight multipart upload for a pending file, rather than deleting a never-completed object', async () => {
    const { fileId, storageKey, uploadId } = await initiateUpload(token);

    await request(app.getHttpServer())
      .delete(`/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();

    // Multipart is genuinely aborted in MinIO: listing its parts fails.
    await expect(
      internalS3.send(
        new ListPartsCommand({
          Bucket: process.env.S3_BUCKET,
          Key: storageKey,
          UploadId: uploadId,
        }),
      ),
    ).rejects.toThrow();
  });

  it('deletes a tombstone row (storageKey already null) without touching storage', async () => {
    const { fileId } = await uploadReadyFile(token);
    await prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.expired, storageKey: null, uploadId: null },
    });

    await request(app.getHttpServer())
      .delete(`/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();
  });

  it('is idempotent: a second delete on the same file returns 404, never 500', async () => {
    const { fileId } = await uploadReadyFile(token);

    await request(app.getHttpServer())
      .delete(`/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .delete(`/files/${fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
