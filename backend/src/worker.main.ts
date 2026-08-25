import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { ScanWorkerModule } from './scan/scan-worker.module';

// Point d'entrée du conteneur worker. `createApplicationContext` et non
// `create` : ce processus consomme une file, il n'écoute sur aucun port.
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(ScanWorkerModule);
  app.enableShutdownHooks();
  new Logger('WorkerBootstrap').log('Validation worker ready');
}
void bootstrap();
