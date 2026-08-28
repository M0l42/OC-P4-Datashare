import { ConfigService } from '@nestjs/config';
import { PurgeWorker } from './purge.worker';
import { PurgeService } from './purge.service';
import { PURGE_QUEUE_NAME } from './purge.constants';

const mockWorkerInstance = {
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((...args: unknown[]) => ({
    ...mockWorkerInstance,
    // Stashed so tests can invoke the processor the worker was built with.
    __processor: args[1],
  })),
}));

describe('PurgeWorker', () => {
  let worker: PurgeWorker;
  let mockPurgeService: { runDailySweep: jest.Mock };
  let WorkerMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WorkerMock = require('bullmq').Worker;
    mockPurgeService = {
      runDailySweep: jest
        .fn()
        .mockResolvedValue({ expired: 1, ghostRowsPurged: 2, abandonedReaped: 3 }),
    };
    const mockConfig = { get: () => 'redis://redis:6379' } as unknown as ConfigService;
    worker = new PurgeWorker(mockConfig, mockPurgeService as unknown as PurgeService);
  });

  it('listens on PURGE_QUEUE_NAME and runs the daily sweep when a job fires', async () => {
    worker.onModuleInit();

    expect(WorkerMock).toHaveBeenCalledWith(
      PURGE_QUEUE_NAME,
      expect.any(Function),
      expect.any(Object),
    );

    const instance = WorkerMock.mock.results[0].value as {
      __processor: () => Promise<unknown>;
    };
    const result = await instance.__processor();

    expect(mockPurgeService.runDailySweep).toHaveBeenCalled();
    expect(result).toEqual({ expired: 1, ghostRowsPurged: 2, abandonedReaped: 3 });
  });

  it('onModuleDestroy closes the underlying worker', async () => {
    worker.onModuleInit();
    await worker.onModuleDestroy();

    const instance = WorkerMock.mock.results[0].value as { close: jest.Mock };
    expect(instance.close).toHaveBeenCalled();
  });

  it('onModuleDestroy is a no-op if the worker never started', async () => {
    await expect(worker.onModuleDestroy()).resolves.toBeUndefined();
  });
});
