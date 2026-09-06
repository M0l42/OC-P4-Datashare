import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  PURGE_QUEUE_NAME,
  PURGE_SWEEP_CRON,
  PURGE_SWEEP_JOB_ID,
} from './purge.constants';
import { redisConnectionFrom } from '../scan/redis.config';

// Contrairement à ScanQueueService (mis en file par l'API à chaque upload
// complété), rien ne déclenche cette file par requête : elle porte un seul
// job planifié, enregistré au démarrage du worker via upsertJobScheduler
// (BullMQ 6+ ; `repeat` a été retiré de Queue#add). Même jobSchedulerId à
// chaque redémarrage : BullMQ ne duplique pas le planning.
@Injectable()
export class PurgeQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PurgeQueueService.name);
  private readonly queue: Queue;

  constructor(config: ConfigService) {
    this.queue = new Queue(PURGE_QUEUE_NAME, {
      connection: redisConnectionFrom(config),
    });
  }

  async onModuleInit() {
    await this.queue.upsertJobScheduler(
      PURGE_SWEEP_JOB_ID,
      { pattern: PURGE_SWEEP_CRON },
      { name: 'sweep', opts: { removeOnComplete: true, removeOnFail: false } },
    );
    this.logger.log(`Daily purge sweep scheduled (${PURGE_SWEEP_CRON})`);
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
