import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerStorageRedisService } from '@nest-lab/throttler-storage-redis';
import { redisConnectionFrom } from '../scan/redis.config';

// Stockage Redis (pas la mémoire du process) : partagé entre les réplicas
// derrière HAProxy. Connexion dédiée, séparée de celle de BullMQ.
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        storage: new ThrottlerStorageRedisService(redisConnectionFrom(config)),
        // Échappatoire pour le load test k6 (QA-06) : sans PERF_TEST_SECRET
        // positionnée côté serveur, ce code est un no-op.
        skipIf: (context: ExecutionContext) => {
          const secret = process.env.PERF_TEST_SECRET;
          if (!secret) return false;
          const req = context.switchToHttp().getRequest<{ headers: Record<string, string> }>();
          return req.headers['x-perf-test-secret'] === secret;
        },
        throttlers: [
          // /auth/login et /auth/register : compteurs distincts, par IP.
          { name: 'authLogin', ttl: 60_000, limit: 10 },
          { name: 'authRegister', ttl: 60_000, limit: 10 },
          // /d/:token : dlToken (GET, polling) et dlTokenPassword (POST,
          // mot de passe) sont séparés exprès, voir SECURITY.md. dlIp
          // s'applique aux deux verbes.
          {
            name: 'dlToken',
            ttl: 120_000,
            limit: 60,
            getTracker: (req: Record<string, any>) =>
              (req.params as { token: string }).token,
          },
          {
            name: 'dlTokenPassword',
            ttl: 120_000,
            limit: 6,
            getTracker: (req: Record<string, any>) =>
              (req.params as { token: string }).token,
          },
          { name: 'dlIp', ttl: 60_000, limit: 100 },
        ],
      }),
    }),
  ],
  exports: [ThrottlerModule],
})
export class RedisThrottlerModule {}
