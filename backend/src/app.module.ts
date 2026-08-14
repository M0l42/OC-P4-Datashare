import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    // Toute la configuration passe par l'environnement : aucun hôte, port,
    // bucket ni identifiant écrit en dur. C'est ce qui rend le déploiement
    // ultérieur possible sans toucher au code (voir « Distribution Plan » dans
    // docs/design-decisions.md).
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
