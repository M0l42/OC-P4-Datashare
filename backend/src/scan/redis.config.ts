import { ConfigService } from '@nestjs/config';

export interface RedisConnection {
  host: string;
  port: number;
}

// REDIS_URL est déjà câblé dans docker-compose (redis://redis:6379) ; BullMQ
// attend host/port séparés.
export function redisConnectionFrom(config: ConfigService): RedisConnection {
  const url = new URL(config.get<string>('REDIS_URL') ?? 'redis://redis:6379');
  return { host: url.hostname, port: Number(url.port || 6379) };
}
