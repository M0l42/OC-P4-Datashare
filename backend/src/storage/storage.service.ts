import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export const PART_URL_TTL_SECONDS = 3600;
export const DOWNLOAD_URL_TTL_SECONDS = 60;

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface SignedPart {
  partNumber: number;
  url: string;
}

@Injectable()
export class StorageService {
  private readonly bucket: string;
  // Deux clients distincts : l'un pour les appels serveur → MinIO (réseau
  // Docker interne), l'autre uniquement pour SIGNER des URLs consommées par
  // le navigateur. getSignedUrl ne fait aucun appel réseau ; il construit
  // l'URL à partir de l'endpoint du client, qui doit donc être l'endpoint
  // public, sinon le navigateur reçoit une URL vers `minio`, qu'il ne peut
  // pas résoudre.
  private readonly serverClient: S3Client;
  private readonly signingClient: S3Client;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    const region = config.getOrThrow<string>('S3_REGION');
    const credentials = {
      accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
      secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
    };

    this.serverClient = new S3Client({
      region,
      credentials,
      endpoint: config.getOrThrow<string>('S3_ENDPOINT'),
      forcePathStyle: true,
    });
    this.signingClient = new S3Client({
      region,
      credentials,
      endpoint: config.getOrThrow<string>('S3_PUBLIC_ENDPOINT'),
      forcePathStyle: true,
    });
  }

  async createMultipartUpload(
    key: string,
    contentType: string,
  ): Promise<string> {
    const result = await this.serverClient.send(
      new CreateMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
      }),
    );
    return result.UploadId!;
  }

  async signPartUrls(
    key: string,
    uploadId: string,
    partNumbers: number[],
  ): Promise<SignedPart[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        partNumber,
        url: await getSignedUrl(
          this.signingClient,
          new UploadPartCommand({
            Bucket: this.bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber,
          }),
          { expiresIn: PART_URL_TTL_SECONDS },
        ),
      })),
    );
  }

  async listParts(key: string, uploadId: string): Promise<UploadedPart[]> {
    const result = await this.serverClient.send(
      new ListPartsCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
    return (result.Parts ?? []).map((part) => ({
      partNumber: part.PartNumber!,
      etag: part.ETag!,
      size: part.Size!,
    }));
  }

  async completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: { partNumber: number; etag: string }[],
  ): Promise<void> {
    await this.serverClient.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts.map((part) => ({
            PartNumber: part.partNumber,
            ETag: part.etag,
          })),
        },
      }),
    );
  }

  // Lecture par plage : une signature de fichier tient dans les premiers
  // octets, donc l'objet ne sort PAS du stockage pour ce contrôle. Valider un
  // fichier de 1 Go coûte 64 octets d'egress, pas 1 Go.
  async getObjectRange(key: string, lastByte: number): Promise<Buffer> {
    const result = await this.serverClient.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Range: `bytes=0-${lastByte}`,
      }),
    );
    return Buffer.from(await result.Body!.transformToByteArray());
  }

  // Lecture complète — réservée aux branches qui appellent réellement ClamAV,
  // donc jamais au-delà du plafond de 50 Mo. Voir getObjectRange.
  async getObjectFull(key: string): Promise<Buffer> {
    const result = await this.serverClient.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return Buffer.from(await result.Body!.transformToByteArray());
  }

  async headObject(key: string): Promise<{ contentLength: number }> {
    const result = await this.serverClient.send(
      new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    return { contentLength: result.ContentLength ?? 0 };
  }

  async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
    await this.serverClient.send(
      new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      }),
    );
  }

  async deleteObject(key: string): Promise<void> {
    await this.serverClient.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  // response-content-disposition force le téléchargement plutôt que
  // l'exécution dans le navigateur : sans lui, un .html ou un .svg téléversé
  // s'exécute depuis l'origine du bucket (XSS stocké), ce que ni la liste
  // noire d'extensions ni les octets magiques n'attrapent. Vérifié contre
  // MinIO : le paramètre est honoré.
  async signDownloadUrl(
    key: string,
    downloadFilename: string,
  ): Promise<string> {
    return getSignedUrl(
      this.signingClient,
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ResponseContentDisposition: `attachment; filename="${sanitizeForHeader(downloadFilename)}"`,
        ResponseContentType: 'application/octet-stream',
      }),
      { expiresIn: DOWNLOAD_URL_TTL_SECONDS },
    );
  }
}

// Empêche l'injection dans l'en-tête HTTP Content-Disposition : `originalName`
// vient du client et n'est jamais validé pour ces caractères ailleurs.
function sanitizeForHeader(value: string): string {
  return value.replace(/["\r\n]/g, '');
}
