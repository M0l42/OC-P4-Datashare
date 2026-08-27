import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { WorkerModule } from './worker.module';

// Point d'entrée du conteneur worker. `createApplicationContext` et non
// `create` : ce processus consomme des files (scan, purge), il n'écoute sur
// aucun port.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule);
  app.enableShutdownHooks();
  new Logger('WorkerBootstrap').log('Validation and purge worker ready');
}
void bootstrap();
