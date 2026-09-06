import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { FileState } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Real integration: Postgres + MinIO + the real scan worker, no mocks.
// file-history.controller.spec.ts already covers that the controller
// delegates to the service with the right filter; this covers the part it
// can't, the actual Postgres query behind US05's Tous/Actifs/Expiré filter
// and the tags round-trip (US08), against real rows.
describe('GET /files (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let internalS3: S3Client;
  let token: string;
  const createdFileIds: string[] = [];

  async function uploadAndComplete(
    originalName: string,
    tags?: string[],
  ): Promise<string> {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ originalName, mimeType: 'text/plain', sizeBytes: 13, tags })
      .expect(201);

    const body = initiate.body as { fileId: string };
    createdFileIds.push(body.fileId);
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });

    const putResult = await internalS3.send(
      new UploadPartCommand({
        Bucket: process.env.S3_BUCKET,
        Key: file.storageKey!,
        UploadId: file.uploadId!,
        PartNumber: 1,
        Body: Buffer.from('hello world!!'),
      }),
    );
    await request(app.getHttpServer())
      .post(`/files/uploads/${body.fileId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: putResult.ETag }] })
      .expect(200);

    return body.fileId;
  }

  // Same reasoning as purge.e2e-spec.ts: a real worker is consuming the
  // queue, so forcing state before it settles the row races it.
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

    const email = `file-history-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'testpass123' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'testpass123' })
      .expect(200);
    token = (login.body as { token: string }).token;
  });

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    await app.close();
  });

  it('filters Tous/Actifs/Expiré against real rows', async () => {
    const activeId = await uploadAndComplete('history-active.txt');
    const expiredId = await uploadAndComplete('history-expired.txt');
    await waitForReady(activeId);
    await waitForReady(expiredId);
    await prisma.file.update({
      where: { id: expiredId },
      data: { state: FileState.expired, storageKey: null, passwordHash: null },
    });

    const active = await request(app.getHttpServer())
      .get('/files')
      .query({ filter: 'active' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const activeIds = (active.body as { id: string }[]).map((f) => f.id);
    expect(activeIds).toContain(activeId);
    expect(activeIds).not.toContain(expiredId);

    const expired = await request(app.getHttpServer())
      .get('/files')
      .query({ filter: 'expired' })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const expiredIds = (expired.body as { id: string }[]).map((f) => f.id);
    expect(expiredIds).toContain(expiredId);
    expect(expiredIds).not.toContain(activeId);

    const all = await request(app.getHttpServer())
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const allIds = (all.body as { id: string }[]).map((f) => f.id);
    expect(allIds).toEqual(expect.arrayContaining([activeId, expiredId]));
  });

  it('round-trips tags (US08) through GET /files', async () => {
    const fileId = await uploadAndComplete('history-tagged.txt', [
      'contrat',
      '2026',
    ]);
    await waitForReady(fileId);

    const res = await request(app.getHttpServer())
      .get('/files')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const file = (res.body as { id: string; tags: string[] }[]).find(
      (f) => f.id === fileId,
    );
    expect(file?.tags).toEqual(['contrat', '2026']);
  });
});
