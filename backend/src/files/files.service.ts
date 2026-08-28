import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcrypt';
import { FileState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService, UploadedPart } from '../storage/storage.service';
import { ScanQueueService } from '../scan/scan-queue.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';
import { HistoryFilter } from './dto/list-files-query.dto';
import {
  BLOCKED_EXTENSIONS,
  DEFAULT_EXPIRY_DAYS,
  MAX_FILE_SIZE_BYTES,
  PART_SIZE_BYTES,
  extensionOf,
} from './upload.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class FilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly scanQueue: ScanQueueService,
  ) {}

  async initiateUpload(ownerId: string, dto: InitiateUploadDto) {
    const extension = extensionOf(dto.originalName);
    if (BLOCKED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        `File extension .${extension} is not allowed`,
      );
    }
    if (dto.sizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new PayloadTooLargeException(
        'Declared file size exceeds the 1 GiB limit',
      );
    }
    if (dto.tags && new Set(dto.tags).size !== dto.tags.length) {
      throw new BadRequestException('Duplicate tags are not allowed');
    }

    const objectKey = `uploads/${randomUUID()}`;
    const uploadId = await this.storage.createMultipartUpload(
      objectKey,
      dto.mimeType,
    );

    const numParts = Math.max(1, Math.ceil(dto.sizeBytes / PART_SIZE_BYTES));
    const partNumbers = Array.from({ length: numParts }, (_, i) => i + 1);
    const parts = await this.storage.signPartUrls(
      objectKey,
      uploadId,
      partNumbers,
    );

    const expiresInDays = dto.expiresInDays ?? DEFAULT_EXPIRY_DAYS;
    const expiresAt = new Date(Date.now() + expiresInDays * MS_PER_DAY);
    const passwordHash = dto.password
      ? await bcrypt.hash(dto.password, 10)
      : null;
    // 128 bits, 22 caractères base64url. Volontairement pas un UUID v7 :
    // celui-ci embarque un horodatage, ce qui rendrait le jeton partiellement
    // prévisible.
    const downloadToken = randomBytes(16).toString('base64url');

    const file = await this.prisma.file.create({
      data: {
        originalName: dto.originalName,
        mimeType: dto.mimeType,
        sizeBytes: dto.sizeBytes,
        storageKey: objectKey,
        downloadToken,
        passwordHash,
        expiresAt,
        state: FileState.pending,
        uploadId,
        partSize: PART_SIZE_BYTES,
        showSender: dto.showSender ?? false,
        tags: dto.tags ?? [],
        ownerId,
      },
    });

    // Le jeton est généré et stocké dès maintenant, mais gardé côté serveur
    // jusqu'à `complete` : le renvoyer ici créerait un quatrième cas
    // indistinguable des trois réponses volontairement identiques de
    // `GET /d/:token` (jeton inconnu / refusé / supprimé), ce qui va à
    // l'encontre du principe anti-oracle.
    return { fileId: file.id, partSize: PART_SIZE_BYTES, parts };
  }

  async getUploadParts(ownerId: string, fileId: string) {
    const file = await this.findPendingUpload(ownerId, fileId);
    const numParts = Math.max(1, Math.ceil(file.sizeBytes / file.partSize));

    let completedParts: UploadedPart[];
    try {
      completedParts = await this.storage.listParts(
        file.storageKey!,
        file.uploadId!,
      );
    } catch (error) {
      if (isNoSuchUpload(error)) {
        throw new GoneException(
          'This upload has expired server-side; start a new one',
        );
      }
      throw error;
    }

    const completedNumbers = new Set(
      completedParts.map((part) => part.partNumber),
    );
    const missingNumbers = Array.from(
      { length: numParts },
      (_, i) => i + 1,
    ).filter((n) => !completedNumbers.has(n));
    const missingParts = await this.storage.signPartUrls(
      file.storageKey!,
      file.uploadId!,
      missingNumbers,
    );

    return {
      totalParts: numParts,
      partSize: file.partSize,
      completedParts,
      missingParts,
    };
  }

  async completeUpload(
    ownerId: string,
    fileId: string,
    dto: CompleteUploadDto,
  ) {
    const file = await this.findPendingUpload(ownerId, fileId);

    const sortedParts = [...dto.parts].sort(
      (a, b) => a.partNumber - b.partNumber,
    );
    await this.storage.completeMultipartUpload(
      file.storageKey!,
      file.uploadId!,
      sortedParts,
    );

    // Un PUT pré-signé ne contraint pas Content-Length (vérifié au spike :
    // 1 Mio déclaré, 25 Mio poussés, accepté sans erreur). La taille déclarée
    // à l'initiation n'est donc pas un contrôle ; HeadObject après complétion
    // est le seul réel. Deux vérifications distinctes, pas une seule :
    // le plafond absolu (indépendant de ce que le client a annoncé), et la
    // correspondance exacte avec ce qu'il a annoncé (un client honnête
    // produit toujours un objet de taille strictement égale à `sizeBytes`).
    const { contentLength } = await this.storage.headObject(file.storageKey!);
    if (contentLength > MAX_FILE_SIZE_BYTES) {
      await this.storage.deleteObject(file.storageKey!);
      await this.prisma.file.update({
        where: { id: file.id },
        data: { state: FileState.rejected, storageKey: null },
      });
      throw new PayloadTooLargeException(
        'Uploaded object exceeds the 1 GiB limit',
      );
    }
    if (contentLength !== file.sizeBytes) {
      await this.storage.deleteObject(file.storageKey!);
      await this.prisma.file.update({
        where: { id: file.id },
        data: { state: FileState.rejected, storageKey: null },
      });
      throw new BadRequestException(
        `Uploaded object size (${contentLength}) does not match declared size (${file.sizeBytes})`,
      );
    }

    // `uploaded`, PAS `ready` : le lien ne résout que dans `ready`, et c'est
    // le worker (SOC-05) qui décide de `ready` vs `rejected` après octets
    // magiques et ClamAV. La règle provisoire de US01-A, qui sautait
    // directement à `ready` faute de worker, est levée ici.
    const updated = await this.prisma.file.update({
      where: { id: file.id },
      data: { state: FileState.uploaded },
    });
    await this.scanQueue.enqueueValidation(updated.id);

    // Aucun jeton renvoyé ici (diagramme 4, étape 16 : « pas encore de
    // lien »). Un fichier que le scan refusera ensuite ne doit jamais avoir
    // eu de lien partageable, même brièvement. L'expéditeur récupère le sien
    // via getUploadStatus une fois l'état `ready`.
    return { id: updated.id, state: updated.state };
  }

  // Suivi de l'attente de scan côté expéditeur. Le jeton n'est inclus que
  // dans l'état `ready` : même règle que ci-dessus, appliquée au polling.
  async getUploadStatus(ownerId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, ownerId },
      select: {
        id: true,
        state: true,
        downloadToken: true,
        originalName: true,
      },
    });
    if (!file) {
      throw new NotFoundException('Upload not found');
    }
    return {
      id: file.id,
      state: file.state,
      originalName: file.originalName,
      downloadToken:
        file.state === FileState.ready ? file.downloadToken : undefined,
    };
  }

  async abortUpload(ownerId: string, fileId: string) {
    const file = await this.findPendingUpload(ownerId, fileId);
    await this.storage.abortMultipartUpload(file.storageKey!, file.uploadId!);
    await this.prisma.file.delete({ where: { id: file.id } });
  }

  // `rejected` has no filter tab of its own — it only surfaces under `all`
  // — because the mockups draw exactly three segments
  // (Tous/Actifs/Expiré) and a refused file is neither active nor expired.
  // `pending`/`uploaded`/`scanning`/`abandoned` never appear here: nothing
  // has been "sent" yet from the owner's point of view.
  async listFiles(ownerId: string, filter: HistoryFilter = 'all') {
    const states: FileState[] =
      filter === 'active'
        ? [FileState.ready]
        : filter === 'expired'
          ? [FileState.expired]
          : [FileState.ready, FileState.expired, FileState.rejected];

    const files = await this.prisma.file.findMany({
      where: { ownerId, state: { in: states } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        originalName: true,
        sizeBytes: true,
        createdAt: true,
        expiresAt: true,
        state: true,
        passwordHash: true,
        downloadToken: true,
      },
    });

    // Same anti-oracle rule as getUploadStatus: the token only ever leaves
    // the server attached to a `ready` row.
    return files.map((file) => ({
      id: file.id,
      originalName: file.originalName,
      sizeBytes: file.sizeBytes,
      createdAt: file.createdAt,
      expiresAt: file.expiresAt,
      state: file.state,
      hasPassword: file.passwordHash !== null,
      downloadToken:
        file.state === FileState.ready ? file.downloadToken : undefined,
    }));
  }

  private async findPendingUpload(ownerId: string, fileId: string) {
    const file = await this.prisma.file.findFirst({
      where: { id: fileId, ownerId },
    });
    if (!file) {
      throw new NotFoundException('Upload not found');
    }
    if (file.state !== FileState.pending) {
      throw new ConflictException(
        `Upload is not pending (current state: ${file.state})`,
      );
    }
    return file;
  }
}

function isNoSuchUpload(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'NoSuchUpload'
  );
}
