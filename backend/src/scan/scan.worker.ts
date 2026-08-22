import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Worker } from 'bullmq';
import { FileState } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationService } from './validation.service';
import { ScanQueueService, type ScanJobData } from './scan-queue.service';
import { redisConnectionFrom } from './redis.config';
import {
  SCAN_QUEUE_NAME,
  SCANNING_STALE_AFTER_MS,
  STALE_SWEEP_INTERVAL_MS,
} from './scan.constants';

// Consommateur. Ne tourne QUE dans le processus worker (worker.main.ts), pas
// dans l'API : c'est un conteneur séparé, sans serveur HTTP.
@Injectable()
export class ScanWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ScanWorker.name);
  private worker?: Worker<ScanJobData>;
  private sweepTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly validation: ValidationService,
    private readonly queue: ScanQueueService,
  ) {}

  onModuleInit() {
    this.worker = new Worker<ScanJobData>(
      SCAN_QUEUE_NAME,
      async (job) => {
        const outcome = await this.validation.validate(job.data.fileId);
        this.logger.log(`File ${job.data.fileId}: ${outcome.kind}`);
        return outcome;
      },
      { connection: redisConnectionFrom(this.config) },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.error(`Validation job ${job?.id} failed: ${error.message}`);
    });

    // Balayage horaire des lignes bloquées en `scanning` : un worker tué
    // en plein job laisse la ligne réclamée mais jamais résolue, donc un
    // lien qui ne résoudra jamais sans que personne ne sache pourquoi.
    this.sweepTimer = setInterval(() => {
      void this.requeueStaleScans();
    }, STALE_SWEEP_INTERVAL_MS);

    this.logger.log('Scan worker started');
  }

  async requeueStaleScans(): Promise<number> {
    const threshold = new Date(Date.now() - SCANNING_STALE_AFTER_MS);
    const stale = await this.prisma.file.findMany({
      where: { state: FileState.scanning, updatedAt: { lt: threshold } },
      select: { id: true },
    });

    for (const file of stale) {
      await this.prisma.file.update({
        where: { id: file.id },
        data: { state: FileState.uploaded },
      });
      await this.queue.enqueueValidation(file.id);
      this.logger.warn(`Requeued stale scanning file ${file.id}`);
    }
    return stale.length;
  }

  async onModuleDestroy() {
    clearInterval(this.sweepTimer);
    await this.worker?.close();
  }
}
