import { Module } from '@nestjs/common';
import { ScanQueueService } from './scan-queue.service';

// Producteur seul : le consommateur (ScanWorker) vit dans ScanWorkerModule.
// Pas d'import de StorageModule : ScanQueueService ne touche jamais S3.
@Module({
  providers: [ScanQueueService],
  exports: [ScanQueueService],
})
export class ScanModule {}
