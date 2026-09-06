import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { DownloadThrottlerGuard } from './download-throttler.guard';
import { PrismaService } from '../prisma/prisma.service';

describe('DownloadThrottlerGuard', () => {
  let guard: DownloadThrottlerGuard;
  let mockPrisma: { file: { findUnique: jest.Mock } };

  function makeContext(token: string): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ params: { token } }),
        getResponse: () => ({}),
      }),
    } as unknown as ExecutionContext;
  }

  function makeRequestProps(token: string) {
    return {
      context: makeContext(token),
      limit: 6,
      ttl: 120_000,
      throttler: { name: 'dlTokenPassword' as const, limit: 6, ttl: 120_000 },
      blockDuration: 120_000,
      getTracker: async () => token,
      generateKey: () => 'key',
    };
  }

  beforeEach(() => {
    mockPrisma = { file: { findUnique: jest.fn() } };
    guard = new DownloadThrottlerGuard(
      { throttlers: [] } as ThrottlerModuleOptions,
      {} as ThrottlerStorage,
      new Reflector(),
      mockPrisma as unknown as PrismaService,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('skips the strict counter entirely when the file has no password', async () => {
    mockPrisma.file.findUnique.mockResolvedValue({ passwordHash: null });
    const baseHandleRequest = jest
      .spyOn(ThrottlerGuard.prototype as never, 'handleRequest')
      .mockResolvedValue(false);

    const allowed = await (
      guard as unknown as {
        handleRequest: (p: unknown) => Promise<boolean>;
      }
    ).handleRequest(makeRequestProps('tok-1'));

    expect(allowed).toBe(true);
    expect(mockPrisma.file.findUnique).toHaveBeenCalledWith({
      where: { downloadToken: 'tok-1' },
      select: { passwordHash: true },
    });
    expect(baseHandleRequest).not.toHaveBeenCalled();
  });

  it('defers to the base counter when the file has a password', async () => {
    mockPrisma.file.findUnique.mockResolvedValue({ passwordHash: 'hashed' });
    const baseHandleRequest = jest
      .spyOn(ThrottlerGuard.prototype as never, 'handleRequest')
      .mockResolvedValue(true);

    const allowed = await (
      guard as unknown as {
        handleRequest: (p: unknown) => Promise<boolean>;
      }
    ).handleRequest(makeRequestProps('tok-2'));

    expect(allowed).toBe(true);
    expect(baseHandleRequest).toHaveBeenCalled();
  });

  it('defers to the base counter for every throttler other than dlTokenPassword', async () => {
    const baseHandleRequest = jest
      .spyOn(ThrottlerGuard.prototype as never, 'handleRequest')
      .mockResolvedValue(true);

    const props = makeRequestProps('tok-3');
    props.throttler = { name: 'dlToken', limit: 60, ttl: 120_000 };
    await (
      guard as unknown as {
        handleRequest: (p: unknown) => Promise<boolean>;
      }
    ).handleRequest(props);

    expect(mockPrisma.file.findUnique).not.toHaveBeenCalled();
    expect(baseHandleRequest).toHaveBeenCalled();
  });
});
