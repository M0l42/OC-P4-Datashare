import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { PurgeService } from './purge.service';
import { PURGE_QUEUE_NAME } from './purge.constants';
import { redisConnectionFrom } from '../scan/redis.config';

// Consommateur. Ne tourne QUE dans le processus worker (worker.main.ts),
// même raisonnement que ScanWorker.
@Injectable()
export class PurgeWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurgeWorker.name);
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly purge: PurgeService,
  ) {}

  onModuleInit() {
    this.worker = new Worker(
      PURGE_QUEUE_NAME,
      async () => {
        const result = await this.purge.runDailySweep();
        this.logger.log(
          `Sweep done: ${result.expired} expired, ` +
            `${result.ghostRowsPurged} ghost row(s) purged, ` +
            `${result.abandonedReaped} abandoned upload(s) reaped`,
        );
        return result;
      },
      { connection: redisConnectionFrom(this.config) },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Purge sweep job ${job?.id} failed: ${error.message}`);
    });

    this.logger.log('Purge worker started');
  }

  async onModuleDestroy() {
    await this.worker?.close();
  }
}
