import { ConfigService } from '@nestjs/config';
import { PurgeQueueService } from './purge-queue.service';
import {
  PURGE_QUEUE_NAME,
  PURGE_SWEEP_CRON,
  PURGE_SWEEP_JOB_ID,
} from './purge.constants';

const mockQueueInstance = {
  upsertJobScheduler: jest.fn().mockResolvedValue(undefined),
  close: jest.fn().mockResolvedValue(undefined),
};

jest.mock('bullmq', () => ({
  Queue: jest.fn().mockImplementation(() => mockQueueInstance),
}));

describe('PurgeQueueService', () => {
  let service: PurgeQueueService;
  let QueueMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    QueueMock = require('bullmq').Queue;
    const mockConfig = { get: () => 'redis://redis:6379' } as unknown as ConfigService;
    service = new PurgeQueueService(mockConfig);
  });

  it('names the queue after PURGE_QUEUE_NAME', () => {
    expect(QueueMock).toHaveBeenCalledWith(
      PURGE_QUEUE_NAME,
      expect.any(Object),
    );
  });

  it('onModuleInit registers a single daily scheduler under a stable id', async () => {
    await service.onModuleInit();

    expect(mockQueueInstance.upsertJobScheduler).toHaveBeenCalledWith(
      PURGE_SWEEP_JOB_ID,
      { pattern: PURGE_SWEEP_CRON },
      expect.objectContaining({ name: 'sweep' }),
    );
  });

  it('onModuleDestroy closes the underlying queue', async () => {
    await service.onModuleDestroy();

    expect(mockQueueInstance.close).toHaveBeenCalled();
  });
});
