import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AbortMultipartUploadCommand,
  HeadObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { FileState } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';
import { StorageModule } from './../src/storage/storage.module';
import { FileDeletionService } from './../src/files/file-deletion.service';
import { PurgeService } from './../src/purge/purge.service';

// Real integration: Postgres + MinIO from docker-compose, no mocks.
// PurgeService is exercised directly rather than through the BullMQ
// schedule (worker.main.ts / PurgeQueueService) — the schedule itself is a
// thin wrapper (see purge-queue.service.ts) and isn't worth a 24h wait in a
// test suite. Threshold/dispatch logic is already covered in isolation by
// purge.service.spec.ts; this checks it against real rows, real storage,
// and the real HTTP contract that US01-R's resume flow will depend on.
describe('Purge sweep (e2e)', () => {
  jest.setTimeout(30_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let purge: PurgeService;
  let internalS3: S3Client;
  let token: string;
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

  async function initiateUpload(): Promise<{
    fileId: string;
    storageKey: string;
    uploadId: string;
  }> {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'purge-e2e.txt',
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

  async function backdateCreatedAt(fileId: string, hoursAgo: number) {
    await prisma.file.update({
      where: { id: fileId },
      data: { createdAt: new Date(Date.now() - hoursAgo * 60 * 60 * 1000) },
    });
  }

  // A real scan worker is consuming the queue in this environment, so a row
  // that just went through complete() is still being moved through
  // uploaded → scanning → ready on its own. Forcing state before the worker
  // is done races it. Wait for the worker to settle the row first.
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
      imports: [AppModule, StorageModule],
      providers: [FileDeletionService, PurgeService],
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
    purge = moduleFixture.get(PurgeService);
    internalS3 = new S3Client({
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY!,
        secretAccessKey: process.env.S3_SECRET_KEY!,
      },
    });

    token = await registerAndLogin('purge-e2e');
  });

  afterAll(async () => {
    await prisma.file.deleteMany({ where: { id: { in: createdFileIds } } });
    await app.close();
  });

  it('expires a ready file past its expiry date: object gone, row kept as a tombstone', async () => {
    const { fileId, storageKey, uploadId } = await initiateUpload();
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
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: putResult.ETag }] })
      .expect(200);

    // Let the worker genuinely settle the row to `ready` before overriding
    // it — otherwise this update races the worker's own transition and
    // whichever write lands last wins.
    await waitForReady(fileId);

    // Now safe to force the expiry in the past — only the purge threshold
    // is the point of this test, not the scan itself.
    await prisma.file.update({
      where: { id: fileId },
      data: {
        state: FileState.ready,
        expiresAt: new Date(Date.now() - 1000),
        passwordHash: 'irrelevant-hash',
      },
    });

    const count = await purge.expireReadyFiles();
    expect(count).toBeGreaterThanOrEqual(1);

    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.state).toBe(FileState.expired);
    expect(row.storageKey).toBeNull();
    expect(row.passwordHash).toBeNull();

    await expect(
      internalS3.send(
        new HeadObjectCommand({
          Bucket: process.env.S3_BUCKET,
          Key: storageKey,
        }),
      ),
    ).rejects.toThrow();
  });

  it('is idempotent: running the expiry pass twice does not error on an already-expired row', async () => {
    const { fileId } = await initiateUpload();
    await prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.expired, storageKey: null, uploadId: null },
    });

    await expect(purge.expireReadyFiles()).resolves.toBeGreaterThanOrEqual(0);
    await expect(purge.expireReadyFiles()).resolves.toBeGreaterThanOrEqual(0);
  });

  it('purges a ghost row only once it is older than the 7-day retention window', async () => {
    const { fileId } = await initiateUpload();
    await prisma.file.update({
      where: { id: fileId },
      data: {
        state: FileState.expired,
        storageKey: null,
        uploadId: null,
        updatedAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000), // 6 days: not yet
      },
    });

    await purge.purgeGhostRows();
    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeTruthy();

    await prisma.file.update({
      where: { id: fileId },
      data: { updatedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000) }, // 8 days: past the window
    });

    await purge.purgeGhostRows();
    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();
  });

  it('does not touch a pending upload still inside the 48h window', async () => {
    const { fileId } = await initiateUpload();

    await purge.reapAbandonedUploads();

    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeTruthy();
  });

  it('reaps a pending upload past the 48h window: multipart aborted, row purged', async () => {
    const { fileId, storageKey, uploadId } = await initiateUpload();
    await backdateCreatedAt(fileId, 49);

    await purge.reapAbandonedUploads();

    await expect(
      prisma.file.findUnique({ where: { id: fileId } }),
    ).resolves.toBeNull();

    // The abort is real at the S3 API, not just a local state change —
    // uploading against the now-aborted multipart fails.
    await expect(
      internalS3.send(
        new UploadPartCommand({
          Bucket: process.env.S3_BUCKET,
          Key: storageKey,
          UploadId: uploadId,
          PartNumber: 1,
          Body: Buffer.from('too late'),
        }),
      ),
    ).rejects.toThrow();
  });

  it('once the multipart is gone at the storage layer — the state the reaper produces past 48h — the resume endpoint refuses explicitly instead of failing unexplained (the condition US01-R depends on)', async () => {
    const { fileId, storageKey, uploadId } = await initiateUpload();

    // Abort at the storage layer only, leaving the row `pending`: this is
    // the exact window deleteFileCompletely passes through mid-reap (abort,
    // then row delete), and it's also what a natural NoSuchUpload from any
    // other cause looks like. What matters for this endpoint's contract is
    // "multipart gone, row still readable", not how it got that way.
    await internalS3.send(
      new AbortMultipartUploadCommand({
        Bucket: process.env.S3_BUCKET,
        Key: storageKey,
        UploadId: uploadId,
      }),
    );

    // See files.service.ts#getUploadParts: it translates the storage
    // layer's NoSuchUpload into 410 Gone with an explicit message, rather
    // than letting the ListParts error propagate as an unexplained failure.
    await request(app.getHttpServer())
      .get(`/files/uploads/${fileId}/parts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(410);
  });
});
