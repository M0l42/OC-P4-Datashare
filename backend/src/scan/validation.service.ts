import { Injectable, Logger } from '@nestjs/common';
import { FileState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ClamAvClient } from './clamav.client';
import { verifyMagicBytes } from './magic-bytes';
import { extensionOf } from '../files/upload.constants';
import { CLAMAV_MAX_SCAN_BYTES, MAGIC_BYTES_RANGE_END } from './scan.constants';

export type ValidationOutcome =
  | { kind: 'ready' }
  | { kind: 'rejected'; reason: string }
  | { kind: 'skipped'; reason: string };

@Injectable()
export class ValidationService {
  private readonly logger = new Logger(ValidationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly clamav: ClamAvClient,
  ) {}

  async validate(fileId: string): Promise<ValidationOutcome> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) {
      // La ligne a pu être supprimée entre la mise en file et le job
      // (annulation explicite, suppression par le propriétaire).
      return { kind: 'skipped', reason: 'file no longer exists' };
    }
    if (
      file.state !== FileState.uploaded &&
      file.state !== FileState.scanning
    ) {
      return { kind: 'skipped', reason: `state is ${file.state}` };
    }

    // POSE `scanning` au démarrage du job, pas seulement une lecture :
    // c'est ce qui rend un worker mort détectable (une ligne bloquée en
    // `scanning` au-delà de 15 min est remise en file).
    await this.prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.scanning },
    });

    // ── Étape 1 : octets magiques, lecture par PLAGE ────────────────────
    // 64 octets suffisent pour toute signature. Valider un fichier de 1 Go
    // coûte donc 64 octets d'egress, pas 1 Go.
    const head = await this.storage.getObjectRange(
      file.storageKey!,
      MAGIC_BYTES_RANGE_END,
    );
    const verdict = verifyMagicBytes(extensionOf(file.originalName), head);
    if (verdict.kind === 'mismatch') {
      // Refusé SANS jamais avoir lu l'objet entier.
      return this.reject(
        file.id,
        file.storageKey!,
        `extension usurpée (.${verdict.expected})`,
      );
    }

    // ── Étape 2 : ClamAV, objet complet, SOUS le plafond seulement ──────
    // La lecture complète n'a lieu que dans cette branche. Au-delà du
    // plafond, l'objet n'est jamais entièrement retiré de MinIO.
    if (file.sizeBytes > CLAMAV_MAX_SCAN_BYTES) {
      this.logger.warn(
        `File ${fileId} (${file.sizeBytes} bytes) exceeds the ${CLAMAV_MAX_SCAN_BYTES}-byte ClamAV cap: virus scan skipped by design`,
      );
      return this.markReady(file.id);
    }

    const body = await this.storage.getObjectFull(file.storageKey!);
    const scan = await this.clamav.scanBuffer(body);
    if (scan.kind === 'infected') {
      return this.reject(
        file.id,
        file.storageKey!,
        `logiciel malveillant détecté (${scan.signature})`,
      );
    }

    return this.markReady(file.id);
  }

  private async markReady(fileId: string): Promise<ValidationOutcome> {
    await this.prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.ready },
    });
    return { kind: 'ready' };
  }

  // L'objet est supprimé du stockage, la ligne passe à `rejected` et n'est
  // jamais promue : aucun lien ne résout pour un fichier refusé, et
  // `GET /d/:token` le rend indistinguable d'un jeton inconnu.
  private async reject(
    fileId: string,
    storageKey: string,
    reason: string,
  ): Promise<ValidationOutcome> {
    await this.storage.deleteObject(storageKey);
    await this.prisma.file.update({
      where: { id: fileId },
      data: { state: FileState.rejected, storageKey: null },
    });
    this.logger.warn(`File ${fileId} rejected: ${reason}`);
    return { kind: 'rejected', reason };
  }
}
