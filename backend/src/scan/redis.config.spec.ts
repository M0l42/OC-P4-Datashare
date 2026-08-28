import { ConfigService } from '@nestjs/config';
import { redisConnectionFrom } from './redis.config';

describe('redisConnectionFrom', () => {
  it('parses host and port from REDIS_URL', () => {
    const config = { get: () => 'redis://redis-host:6380' } as unknown as ConfigService;

    expect(redisConnectionFrom(config)).toEqual({
      host: 'redis-host',
      port: 6380,
    });
  });

  it('falls back to redis:6379 when REDIS_URL is unset', () => {
    const config = { get: () => undefined } as unknown as ConfigService;

    expect(redisConnectionFrom(config)).toEqual({ host: 'redis', port: 6379 });
  });

  it('defaults the port to 6379 when the URL omits one', () => {
    const config = { get: () => 'redis://redis-host' } as unknown as ConfigService;

    expect(redisConnectionFrom(config)).toEqual({
      host: 'redis-host',
      port: 6379,
    });
  });
});
