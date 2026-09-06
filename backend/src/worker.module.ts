import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScanWorkerModule } from './scan/scan-worker.module';
import { PurgeWorkerModule } from './purge/purge-worker.module';

// Racine du processus worker (worker.main.ts) : un seul conteneur consomme
// les deux files BullMQ, scan et purge. ConfigModule chargé une seule fois
// ici plutôt que dans chaque sous-module.
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScanWorkerModule,
    PurgeWorkerModule,
  ],
})
export class WorkerModule {}
