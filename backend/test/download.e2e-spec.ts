import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  GetObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import * as bcrypt from 'bcrypt';
import { FileState } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Intégration réelle : Postgres et MinIO, aucun mock. `scanning` et `expired`
// n'ont pas de chemin naturel pour être atteints avec le code actuel (la
// règle provisoire de US01-A saute directement à `ready`, et la purge
// planifiée de US10 n'existe pas) : ces lignes sont donc posées directement
// via Prisma, comme le ferait le worker ou le job de purge une fois livrés.
describe('Download (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let internalS3: S3Client;
  let token: string;
  const createdFileIds: string[] = [];

  async function uploadReadyFile(
    overrides: {
      password?: string;
      showSender?: boolean;
    } = {},
  ): Promise<{ fileId: string; downloadToken: string }> {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({
        originalName: 'download-e2e.txt',
        mimeType: 'text/plain',
        sizeBytes: 13,
        password: overrides.password,
        showSender: overrides.showSender,
      })
      .expect(201);

    const body = initiate.body as {
      fileId: string;
      parts: { partNumber: number; url: string }[];
    };
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

    const ready = await prisma.file.findUniqueOrThrow({
      where: { id: body.fileId },
    });
    return { fileId: ready.id, downloadToken: ready.downloadToken };
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

    const email = `download-e2e-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'testpass123', displayName: 'E2E Sender' })
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

  it('returns metadata and a working download URL for a ready file with no password', async () => {
    const { downloadToken } = await uploadReadyFile();

    const metadata = await request(app.getHttpServer())
      .get(`/d/${downloadToken}`)
      .expect(200);
    const downloadUrl = (metadata.body as { downloadUrl: string }).downloadUrl;
    expect(
      (metadata.body as { passwordRequired: boolean }).passwordRequired,
    ).toBe(false);

    // L'URL porte l'endpoint PUBLIC (S3_PUBLIC_ENDPOINT), que ce conteneur ne
    // peut pas résoudre lui-même (même contrainte que pour l'upload) : on
    // vérifie donc ici la mécanique de la signature (host, disposition
    // forcée, TTL) plutôt qu'une requête réellement aboutie. La récupération
    // effective des octets via une URL signée est vérifiée en navigateur réel.
    const parsed = new URL(downloadUrl);
    expect(parsed.host).toBe(new URL(process.env.S3_PUBLIC_ENDPOINT!).host);
    expect(parsed.searchParams.get('response-content-disposition')).toContain(
      'attachment',
    );
    expect(parsed.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(parsed.searchParams.get('X-Amz-Signature')).toBeTruthy();

    // Le contenu réel est vérifié via le client interne, qui pointe sur le
    // même objet et les mêmes identifiants que la signature publique.
    const object = await internalS3.send(
      new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: parsed.pathname.split('/').slice(2).join('/'),
      }),
    );
    expect(await object.Body?.transformToString()).toBe('hello world!!');
  });

  it('includes the sender name only when show_sender is set', async () => {
    const withSender = await uploadReadyFile({ showSender: true });
    const withoutSender = await uploadReadyFile({ showSender: false });

    const withRes = await request(app.getHttpServer())
      .get(`/d/${withSender.downloadToken}`)
      .expect(200);
    expect((withRes.body as { senderName?: string }).senderName).toBe(
      'E2E Sender',
    );

    const withoutRes = await request(app.getHttpServer())
      .get(`/d/${withoutSender.downloadToken}`)
      .expect(200);
    expect(withoutRes.body).not.toHaveProperty('senderName');
  });

  it('withholds the download URL until the correct password is supplied', async () => {
    const { downloadToken } = await uploadReadyFile({ password: 'letmein' });

    const metadata = await request(app.getHttpServer())
      .get(`/d/${downloadToken}`)
      .expect(200);
    expect(
      (metadata.body as { passwordRequired: boolean }).passwordRequired,
    ).toBe(true);
    expect(metadata.body).not.toHaveProperty('downloadUrl');

    await request(app.getHttpServer())
      .post(`/d/${downloadToken}`)
      .send({ password: 'wrong' })
      .expect(401);

    const correct = await request(app.getHttpServer())
      .post(`/d/${downloadToken}`)
      .send({ password: 'letmein' })
      .expect(200);
    expect((correct.body as { downloadUrl: string }).downloadUrl).toContain(
      'X-Amz-Signature',
    );
  });

  it('returns 202 with no download URL while scanning', async () => {
    const { fileId, downloadToken } = await uploadReadyFile();
    await prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.scanning },
    });

    const res = await request(app.getHttpServer())
      .get(`/d/${downloadToken}`)
      .expect(202);
    expect(res.body).not.toHaveProperty('downloadUrl');

    await request(app.getHttpServer())
      .post(`/d/${downloadToken}`)
      .send({})
      .expect(410);
  });

  it('returns 410 for an expired file', async () => {
    const { fileId, downloadToken } = await uploadReadyFile();
    await prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.expired },
    });

    await request(app.getHttpServer()).get(`/d/${downloadToken}`).expect(410);
  });

  it('returns 410 for a row still marked ready but past its expiry date', async () => {
    const { fileId, downloadToken } = await uploadReadyFile();
    await prisma.file.update({
      where: { id: fileId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await request(app.getHttpServer()).get(`/d/${downloadToken}`).expect(410);
  });

  it('returns an identical 404 for an unknown token, a rejected file, and an abandoned file', async () => {
    const unknown = await request(app.getHttpServer())
      .get('/d/does-not-exist')
      .expect(404);

    const { fileId: rejectedId, downloadToken: rejectedToken } =
      await uploadReadyFile();
    await prisma.file.update({
      where: { id: rejectedId },
      data: { state: FileState.rejected },
    });
    const rejected = await request(app.getHttpServer())
      .get(`/d/${rejectedToken}`)
      .expect(404);

    const { fileId: abandonedId, downloadToken: abandonedToken } =
      await uploadReadyFile();
    await prisma.file.update({
      where: { id: abandonedId },
      data: { state: FileState.abandoned },
    });
    const abandoned = await request(app.getHttpServer())
      .get(`/d/${abandonedToken}`)
      .expect(404);

    expect(unknown.body).toEqual(rejected.body);
    expect(rejected.body).toEqual(abandoned.body);
  });

  it('hashes the file password with bcrypt, never stores it in clear', async () => {
    const { fileId } = await uploadReadyFile({ password: 'letmein' });
    const row = await prisma.file.findUniqueOrThrow({ where: { id: fileId } });
    expect(row.passwordHash).not.toBe('letmein');
    expect(await bcrypt.compare('letmein', row.passwordHash!)).toBe(true);
  });
});
