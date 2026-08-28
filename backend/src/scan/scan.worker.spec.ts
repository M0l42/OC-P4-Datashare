import { ConfigService } from '@nestjs/config';
import { FileState } from '@prisma/client';
import { ScanWorker } from './scan.worker';
import { PrismaService } from '../prisma/prisma.service';
import { ValidationService } from './validation.service';
import { ScanQueueService } from './scan-queue.service';
import { SCAN_QUEUE_NAME } from './scan.constants';

const mockWorkerInstance = {
  on: jest.fn(),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bullmq', () => ({
  Worker: jest.fn().mockImplementation((...args: unknown[]) => ({
    ...mockWorkerInstance,
    __processor: args[1],
  })),
}));

describe('ScanWorker', () => {
  let worker: ScanWorker;
  let mockPrisma: { file: { findMany: jest.Mock; update: jest.Mock } };
  let mockValidation: { validate: jest.Mock };
  let mockQueue: { enqueueValidation: jest.Mock };
  let WorkerMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    WorkerMock = require('bullmq').Worker;
    mockPrisma = {
      file: { findMany: jest.fn(), update: jest.fn() },
    };
    mockValidation = { validate: jest.fn() };
    mockQueue = { enqueueValidation: jest.fn() };
    const mockConfig = { get: () => 'redis://redis:6379' } as unknown as ConfigService;

    worker = new ScanWorker(
      mockConfig,
      mockPrisma as unknown as PrismaService,
      mockValidation as unknown as ValidationService,
      mockQueue as unknown as ScanQueueService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('onModuleInit wires a worker on SCAN_QUEUE_NAME whose processor runs validation', async () => {
    worker.onModuleInit();

    expect(WorkerMock).toHaveBeenCalledWith(
      SCAN_QUEUE_NAME,
      expect.any(Function),
      expect.any(Object),
    );

    mockValidation.validate.mockResolvedValue({ kind: 'ready' });
    const instance = WorkerMock.mock.results[0].value as {
      __processor: (job: { data: { fileId: string } }) => Promise<unknown>;
    };
    const result = await instance.__processor({ data: { fileId: 'file-1' } });

    expect(mockValidation.validate).toHaveBeenCalledWith('file-1');
    expect(result).toEqual({ kind: 'ready' });
  });

  describe('requeueStaleScans', () => {
    it('requeues rows stuck in scanning past the staleness threshold', async () => {
      mockPrisma.file.findMany.mockResolvedValue([{ id: 'file-1' }, { id: 'file-2' }]);
      mockPrisma.file.update.mockResolvedValue({});

      const count = await worker.requeueStaleScans();

      expect(mockPrisma.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ state: FileState.scanning }),
        }),
      );
      expect(mockPrisma.file.update).toHaveBeenCalledWith({
        where: { id: 'file-1' },
        data: { state: FileState.uploaded },
      });
      expect(mockQueue.enqueueValidation).toHaveBeenCalledWith('file-1');
      expect(mockQueue.enqueueValidation).toHaveBeenCalledWith('file-2');
      expect(count).toBe(2);
    });

    it('does nothing when no scan is stale', async () => {
      mockPrisma.file.findMany.mockResolvedValue([]);

      await expect(worker.requeueStaleScans()).resolves.toBe(0);
      expect(mockQueue.enqueueValidation).not.toHaveBeenCalled();
    });
  });

  it('onModuleDestroy stops the sweep timer and closes the worker', async () => {
    worker.onModuleInit();
    const clearSpy = jest.spyOn(global, 'clearInterval');

    await worker.onModuleDestroy();

    expect(clearSpy).toHaveBeenCalled();
    const instance = WorkerMock.mock.results[0].value as { close: jest.Mock };
    expect(instance.close).toHaveBeenCalled();
  });
});
