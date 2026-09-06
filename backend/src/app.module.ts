import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino-http';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { FilesModule } from './files/files.module';
import { DownloadModule } from './download/download.module';
import { RedisThrottlerModule } from './throttler/throttler.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule.forRoot({
      pinoHttp: {
        // Jamais l'Authorization/cookie/mot de passe ni x-perf-test-secret
        // (throttler.module.ts) en clair dans les logs.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers["x-perf-test-secret"]',
            'req.body.password',
          ],
          censor: '[redacted]',
        },
        // `redact` ne touche pas req.url : le jeton de /d/:token y apparaît en
        // clair par défaut. Masqué ici pour la même raison que l'Authorization
        // ci-dessus — un log n'est pas un coffre-fort, mais il ne doit pas en
        // devenir un accidentellement.
        serializers: {
          req: (req: unknown) => {
            const serialized = stdSerializers.req(req as Parameters<typeof stdSerializers.req>[0]);
            serialized.url = serialized.url.replace(/^(\/api)?\/d\/[^/?]+/, '$1/d/[redacted]');
            return serialized;
          },
        },
        // Le niveau NestJS "log" correspond à "info" côté pino.
        customLogLevel: () => 'info',
      },
    }),
    PrismaModule,
    RedisThrottlerModule,
    AuthModule,
    FilesModule,
    DownloadModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService],
})
export class AppModule {}
