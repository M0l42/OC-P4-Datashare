import { Injectable, Logger } from '@nestjs/common';
import { FileState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FileDeletionService } from '../files/file-deletion.service';
import {
  ABANDONED_UPLOAD_TTL_HOURS,
  GHOST_ROW_TTL_DAYS,
} from './purge.constants';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_HOUR = 60 * 60 * 1000;

export interface PurgeSweepResult {
  expired: number;
  ghostRowsPurged: number;
  abandonedReaped: number;
}

// Les trois passes planifiées de US10. La quatrième (scanning bloqué) existe
// déjà — voir ScanWorker#requeueStaleScans, héritée de SOC-05.
@Injectable()
export class PurgeService {
  private readonly logger = new Logger(PurgeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly deletion: FileDeletionService,
  ) {}

  async runDailySweep(): Promise<PurgeSweepResult> {
    const expired = await this.expireReadyFiles();
    const ghostRowsPurged = await this.purgeGhostRows();
    const abandonedReaped = await this.reapAbandonedUploads();
    return { expired, ghostRowsPurged, abandonedReaped };
  }

  // Passe 1 : fichiers `ready` dont expiresAt est dépassé. L'objet part, la
  // ligne reste comme fantôme pour que l'historique de US05 puisse encore
  // afficher "expiré" — voir la résolution de contradiction dans
  // docs/design-decisions.md.
  async expireReadyFiles(): Promise<number> {
    const candidates = await this.prisma.file.findMany({
      where: { state: FileState.ready, expiresAt: { lt: new Date() } },
      select: { id: true, storageKey: true },
    });

    let count = 0;
    for (const file of candidates) {
      if (file.storageKey) {
        await this.storage.deleteObject(file.storageKey);
      }
      // updateMany + garde sur l'état, pas update : une relance concurrente
      // du sweep, ou une suppression manuelle (US06) entre-temps, ne doit ni
      // planter ni faire régresser une ligne déjà transitionnée.
      const result = await this.prisma.file.updateMany({
        where: { id: file.id, state: FileState.ready },
        data: {
          state: FileState.expired,
          storageKey: null,
          passwordHash: null,
        },
      });
      count += result.count;
    }
    this.logger.log(`Expired ${count} file(s)`);
    return count;
  }

  // Passe 2 : lignes fantômes (`expired`/`rejected`) au-delà de la fenêtre
  // de rétention. Réutilise purgeTombstone (US06) : storageKey est déjà nul
  // pour ces deux états, donc DeleteObject ne peut structurellement pas être
  // atteint ici.
  async purgeGhostRows(): Promise<number> {
    const cutoff = new Date(Date.now() - GHOST_ROW_TTL_DAYS * MS_PER_DAY);
    const candidates = await this.prisma.file.findMany({
      where: {
        state: { in: [FileState.expired, FileState.rejected] },
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    });

    for (const file of candidates) {
      await this.deletion.purgeTombstone(file.id);
    }
    this.logger.log(`Purged ${candidates.length} ghost row(s)`);
    return candidates.length;
  }

  // Passe 3 : le reaper. `pending` au-delà de la fenêtre de 48 h. Réutilise
  // deleteFileCompletely (US06), qui avorte déjà le multipart pour l'état
  // `pending`. C'est cette passe qui rend NoSuchUpload vrai côté S3 au-delà
  // de la fenêtre — condition dont dépend US01-R.
  async reapAbandonedUploads(): Promise<number> {
    const cutoff = new Date(
      Date.now() - ABANDONED_UPLOAD_TTL_HOURS * MS_PER_HOUR,
    );
    const candidates = await this.prisma.file.findMany({
      where: { state: FileState.pending, createdAt: { lt: cutoff } },
      select: { id: true },
    });

    for (const file of candidates) {
      await this.deletion.deleteFileCompletely(file.id);
    }
    this.logger.log(`Reaped ${candidates.length} abandoned upload(s)`);
    return candidates.length;
  }
}
