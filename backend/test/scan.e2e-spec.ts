import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { S3Client, UploadPartCommand } from '@aws-sdk/client-s3';
import { FileState } from '@prisma/client';
import { AppModule } from './../src/app.module';
import { PrismaService } from './../src/prisma/prisma.service';

// Chaîne EICAR : le fichier de test antivirus standard. Ce n'est PAS un
// logiciel malveillant — c'est une signature que tous les moteurs
// reconnaissent par convention, précisément pour tester une chaîne de scan
// sans manipuler de vrai malware. Concaténée pour qu'aucun antivirus ne
// signale ce fichier source lui-même.
const EICAR = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',
  '-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
].join('');

// En-tête d'un exécutable Windows, dans un fichier annoncé comme .pdf.
const MZ_HEADER = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

// Chaîne complète contre la vraie pile : Postgres, MinIO, Redis, le worker
// (conteneur séparé) et ClamAV. Rien n'est simulé.
describe('Scan pipeline (e2e)', () => {
  jest.setTimeout(60_000);

  let app: INestApplication<App>;
  let prisma: PrismaService;
  let internalS3: S3Client;
  let token: string;
  const createdFileIds: string[] = [];

  async function uploadAndComplete(
    originalName: string,
    mimeType: string,
    body: Buffer,
  ) {
    const initiate = await request(app.getHttpServer())
      .post('/files/uploads')
      .set('Authorization', `Bearer ${token}`)
      .send({ originalName, mimeType, sizeBytes: body.length })
      .expect(201);

    const initiated = initiate.body as { fileId: string };
    createdFileIds.push(initiated.fileId);
    const file = await prisma.file.findUniqueOrThrow({
      where: { id: initiated.fileId },
    });

    const putResult = await internalS3.send(
      new UploadPartCommand({
        Bucket: process.env.S3_BUCKET,
        Key: file.storageKey!,
        UploadId: file.uploadId!,
        PartNumber: 1,
        Body: body,
      }),
    );

    const complete = await request(app.getHttpServer())
      .post(`/files/uploads/${initiated.fileId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .send({ parts: [{ partNumber: 1, etag: putResult.ETag }] })
      .expect(200);

    return {
      fileId: initiated.fileId,
      completeBody: complete.body as Record<string, unknown>,
      downloadToken: file.downloadToken,
    };
  }

  async function waitForSettled(fileId: string) {
    for (let attempt = 0; attempt < 120; attempt++) {
      const file = await prisma.file.findUniqueOrThrow({
        where: { id: fileId },
      });
      if (file.state === FileState.ready || file.state === FileState.rejected) {
        return file;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(
      `File ${fileId} never settled (is the worker container running?)`,
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

    const email = `scan-e2e-${Date.now()}@example.com`;
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

  it('never returns a download token at completion time', async () => {
    const { completeBody } = await uploadAndComplete(
      'clean.txt',
      'text/plain',
      Buffer.from('perfectly ordinary content'),
    );

    // Le lien ne doit jamais exister avant l'état `ready` : un fichier que
    // le scan refusera ensuite n'aura donc jamais eu de lien partageable.
    expect(completeBody).toEqual(
      expect.objectContaining({ state: 'uploaded' }),
    );
    expect(completeBody).not.toHaveProperty('downloadToken');
  });

  it('promotes a clean file to ready', async () => {
    const { fileId } = await uploadAndComplete(
      'clean.txt',
      'text/plain',
      Buffer.from('perfectly ordinary content'),
    );

    const settled = await waitForSettled(fileId);
    expect(settled.state).toBe(FileState.ready);
  });

  it('rejects the EICAR test string and never makes it downloadable', async () => {
    const { fileId, downloadToken } = await uploadAndComplete(
      'eicar.txt',
      'text/plain',
      Buffer.from(EICAR),
    );

    const settled = await waitForSettled(fileId);
    expect(settled.state).toBe(FileState.rejected);
    // L'objet est supprimé du stockage, pas seulement marqué.
    expect(settled.storageKey).toBeNull();

    // Et le lien ne résout pas — réponse identique à un jeton inconnu.
    const recipient = await request(app.getHttpServer())
      .get(`/d/${downloadToken}`)
      .expect(404);
    const unknown = await request(app.getHttpServer())
      .get('/d/unknown-token-here')
      .expect(404);
    expect(recipient.body).toEqual(unknown.body);
  });

  it('rejects a spoofed extension (.pdf whose bytes say MZ)', async () => {
    const { fileId } = await uploadAndComplete(
      'invoice.pdf',
      'application/pdf',
      Buffer.concat([MZ_HEADER, Buffer.alloc(500, 0x41)]),
    );

    const settled = await waitForSettled(fileId);
    expect(settled.state).toBe(FileState.rejected);
    expect(settled.storageKey).toBeNull();
  });

  it('accepts a genuine PDF whose bytes match its extension', async () => {
    const { fileId } = await uploadAndComplete(
      'real.pdf',
      'application/pdf',
      Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 0x20)]),
    );

    const settled = await waitForSettled(fileId);
    expect(settled.state).toBe(FileState.ready);
  });
});
