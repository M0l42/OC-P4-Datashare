import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { ScanQueueService } from './scan-queue.service';
import { ClamAvClient } from './clamav.client';
import { ValidationService } from './validation.service';
import { ScanWorker } from './scan.worker';

// Racine du processus worker : pas de contrôleur, donc pas de serveur HTTP.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    StorageModule,
  ],
  providers: [ScanQueueService, ClamAvClient, ValidationService, ScanWorker],
})
export class ScanWorkerModule {}
