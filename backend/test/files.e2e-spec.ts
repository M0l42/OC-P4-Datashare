import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Intégration réelle : Postgres et MinIO du docker-compose, aucun mock.
// Les parties sont envoyées via un client S3 pointé sur l'endpoint INTERNE
// (S3_ENDPOINT), pas sur l'URL pré-signée renvoyée par l'API : cette dernière
// porte l'endpoint PUBLIC (S3_PUBLIC_ENDPOINT), que le conteneur api ne peut
// pas résoudre lui-même. Le rôle du navigateur (US01-B) est testé
// séparément ; ce test valide le contrat serveur des quatre routes.
describe('Files uploads (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let internalS3: S3Client;
  let token: string;
  const createdFileIds: string[] = [];

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

    const email = `files-e2e-${Date.now()}@example.com`;
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

  it('completes a single-part upload end-to-end', async () => {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'e2e-small.txt',
        mimeType: 'text/plain',
        sizeBytes: 13,
      })
      .expect(201);

    const body = initiate.body as {
      fileId: string;
      parts: { partNumber: number; url: string }[];
    };
    createdFileIds.push(body.fileId);
    expect(body.parts).toHaveLength(1);
    expect(body).not.toHaveProperty('downloadToken');

    const file = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });
    // 128 bits, 22 caractères base64url (règle US01-A n°2) — le jeton est
    // généré à l'initiation mais gardé côté serveur jusqu'à `complete`.
    expect(file.downloadToken).toHaveLength(22);

    const putResult = await internalS3.send(
      new UploadPartCommand({
        Bucket: process.env.S3_BUCKET,
        Key: file.storageKey!,
        UploadId: file.uploadId!,
        PartNumber: 1,
        Body: Buffer.from('hello world!!'),
      }),
    );

    const complete = await request(app.getHttpServer())
      .post(`/files/uploads/${body.fileId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: putResult.ETag }] })
      .expect(200);

    // `uploaded`, pas `ready` : c'est le worker (SOC-05) qui promeut après
    // analyse. Et aucun jeton n'est renvoyé ici — un fichier que le scan
    // refusera ensuite ne doit jamais avoir eu de lien partageable.
    expect(complete.body).toEqual({ id: body.fileId, state: 'uploaded' });
    expect(complete.body).not.toHaveProperty('downloadToken');

    const updated = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });
    // Le worker tourne dans un conteneur séparé et peut déjà avoir promu la
    // ligne : les deux états sont acceptables ici, `ready` jamais avant.
    expect(['uploaded', 'scanning', 'ready']).toContain(updated.state);
  });

  it('exposes the download token through the status route only once ready', async () => {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'e2e-status.txt',
        mimeType: 'text/plain',
        sizeBytes: 13,
      })
      .expect(201);
    const body = initiate.body as { fileId: string };
    createdFileIds.push(body.fileId);

    // Encore `pending` : pas de jeton.
    const pending = await request(app.getHttpServer())
      .get(`/files/uploads/${body.fileId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(pending.body).not.toHaveProperty('downloadToken');

    await prisma.file.update({
      where: { id: body.fileId },
      data: { state: 'ready' },
    });

    const ready = await request(app.getHttpServer())
      .get(`/files/uploads/${body.fileId}/status`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(
      (ready.body as { downloadToken?: string }).downloadToken,
    ).toHaveLength(22);
  });

  it('rejects completion when the real size does not match the declared size', async () => {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'e2e-mismatch.txt',
        mimeType: 'text/plain',
        sizeBytes: 13,
      })
      .expect(201);

    const body = initiate.body as { fileId: string };
    createdFileIds.push(body.fileId);
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });

    // Déclaré : 13 octets. Réellement poussé : 20. Une URL PUT pré-signée ne
    // contraint pas Content-Length (voir SECURITY.md), donc ceci est accepté
    // par MinIO ; c'est `complete` qui doit le refuser.
    const putResult = await internalS3.send(
      new UploadPartCommand({
        Bucket: process.env.S3_BUCKET,
        Key: file.storageKey!,
        UploadId: file.uploadId!,
        PartNumber: 1,
        Body: Buffer.from('this is twenty bytes'),
      }),
    );

    await request(app.getHttpServer())
      .post(`/files/uploads/${body.fileId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: putResult.ETag }] })
      .expect(400);

    const updated = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });
    expect(updated.state).toBe('rejected');
  });

  it('lists missing parts for an untouched multi-part upload', async () => {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'e2e-multi.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 9_000_000,
      })
      .expect(201);

    const body = initiate.body as { fileId: string };
    createdFileIds.push(body.fileId);

    const parts = await request(app.getHttpServer())
      .get(`/files/uploads/${body.fileId}/parts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(parts.body).toMatchObject({ totalParts: 2, completedParts: [] });
    expect(
      (parts.body as { missingParts: unknown[] }).missingParts,
    ).toHaveLength(2);
  });

  it('aborts an upload and removes the row', async () => {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'e2e-abort.bin',
        mimeType: 'application/octet-stream',
        sizeBytes: 1_000,
      })
      .expect(201);

    const body = initiate.body as { fileId: string };

    await request(app.getHttpServer())
      .delete(`/files/uploads/${body.fileId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    await request(app.getHttpServer())
      .get(`/files/uploads/${body.fileId}/parts`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await expect(
      prisma.file.findUnique({ where: { id: body.fileId } }),
    ).resolves.toBeNull();
  });
});
