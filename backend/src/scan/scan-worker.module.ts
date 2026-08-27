import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ScanQueueService } from './scan-queue.service';
import { ClamAvClient } from './clamav.client';
import { ValidationService } from './validation.service';
import { ScanWorker } from './scan.worker';

// Sous-graphe scan à l'intérieur du processus worker (voir WorkerModule pour
// le ConfigModule global, désormais chargé une seule fois au niveau racine).
@Module({
  imports: [PrismaModule, StorageModule],
  providers: [ScanQueueService, ClamAvClient, ValidationService, ScanWorker],
})
export class ScanWorkerModule {}
