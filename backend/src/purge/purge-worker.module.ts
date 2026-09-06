import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { FileDeletionService } from '../files/file-deletion.service';
import { PurgeQueueService } from './purge-queue.service';
import { PurgeService } from './purge.service';
import { PurgeWorker } from './purge.worker';

// Racine du sous-graphe de purge à l'intérieur du processus worker. Pas de
// module API-side équivalent à ScanModule : rien ne met cette file en
// attente par requête, elle est purement planifiée (voir PurgeQueueService).
@Module({
  imports: [PrismaModule, StorageModule],
  providers: [
    FileDeletionService,
    PurgeQueueService,
    PurgeService,
    PurgeWorker,
  ],
})
export class PurgeWorkerModule {}
