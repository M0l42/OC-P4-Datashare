import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import { SCAN_QUEUE_NAME } from './scan.constants';
import { redisConnectionFrom } from './redis.config';

export interface ScanJobData {
  fileId: string;
}

// Producteur seul : l'API met en file, le worker (processus séparé) consomme.
@Injectable()
export class ScanQueueService implements OnModuleDestroy {
  private readonly logger = new Logger(ScanQueueService.name);
  private readonly queue: Queue<ScanJobData>;

  constructor(config: ConfigService) {
    this.queue = new Queue<ScanJobData>(SCAN_QUEUE_NAME, {
      connection: redisConnectionFrom(config),
    });
  }

  async enqueueValidation(fileId: string): Promise<void> {
    await this.queue.add(
      'validate',
      { fileId },
      {
        // L'identifiant de job vaut déduplication : deux appels à
        // `complete` pour le même fichier ne produisent qu'un scan.
        jobId: fileId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
    this.logger.log(`Validation job enqueued for file ${fileId}`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
