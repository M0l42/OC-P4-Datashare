import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ScanQueueService } from './scan-queue.service';

// Producteur seul : importé par l'API pour mettre en file. Le consommateur
// (ScanWorker) vit dans ScanWorkerModule, chargé uniquement par le processus
// worker — l'API ne doit jamais consommer ses propres jobs de scan.
@Module({
  imports: [StorageModule],
  providers: [ScanQueueService],
  exports: [ScanQueueService],
})
export class ScanModule {}
