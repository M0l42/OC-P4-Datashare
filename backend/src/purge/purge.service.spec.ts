import { Test, TestingModule } from '@nestjs/testing';
import { FileState } from '@prisma/client';
import { PurgeService } from './purge.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { FileDeletionService } from '../files/file-deletion.service';

describe('PurgeService', () => {
  let service: PurgeService;
  let mockPrismaService: {
    file: {
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let mockStorageService: { deleteObject: jest.Mock };
  let mockDeletionService: {
    purgeTombstone: jest.Mock;
    deleteFileCompletely: jest.Mock;
  };

  beforeEach(async () => {
    mockPrismaService = {
      file: { findMany: jest.fn(), updateMany: jest.fn() },
    };
    mockStorageService = {
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    mockDeletionService = {
      purgeTombstone: jest.fn().mockResolvedValue(undefined),
      deleteFileCompletely: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PurgeService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: FileDeletionService, useValue: mockDeletionService },
      ],
    }).compile();

    service = module.get<PurgeService>(PurgeService);
  });

  describe('expireReadyFiles', () => {
    it('only selects ready files past their expiry date', async () => {
      let where: { state: FileState; expiresAt: { lt: Date } } | undefined;
      mockPrismaService.file.findMany.mockImplementationOnce(
        (args: { where: typeof where }) => {
          where = args.where;
          return Promise.resolve([]);
        },
      );

      await service.expireReadyFiles();

      expect(where?.state).toBe(FileState.ready);
      expect(where?.expiresAt.lt.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('deletes the object and nulls storageKey + passwordHash, keeping the row', async () => {
      mockPrismaService.file.findMany.mockResolvedValue([
        { id: 'f1', storageKey: 'uploads/f1' },
      ]);
      mockPrismaService.file.updateMany.mockResolvedValue({ count: 1 });

      const count = await service.expireReadyFiles();

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        'uploads/f1',
      );
      expect(mockPrismaService.file.updateMany).toHaveBeenCalledWith({
        where: { id: 'f1', state: FileState.ready },
        data: {
          state: FileState.expired,
          storageKey: null,
          passwordHash: null,
        },
      });
      expect(count).toBe(1);
    });

    it('is idempotent: a row already transitioned by a concurrent sweep is not double-counted', async () => {
      mockPrismaService.file.findMany.mockResolvedValue([
        { id: 'f1', storageKey: 'uploads/f1' },
      ]);
      // The state guard in the updateMany where-clause means a row that lost
      // the race (already `expired`) matches zero rows, not an error.
      mockPrismaService.file.updateMany.mockResolvedValue({ count: 0 });

      const count = await service.expireReadyFiles();

      expect(count).toBe(0);
    });
  });

  describe('purgeGhostRows', () => {
    it('selects expired/rejected rows older than the 7-day retention window', async () => {
      let where:
        { state: { in: FileState[] }; updatedAt: { lt: Date } } | undefined;
      mockPrismaService.file.findMany.mockImplementationOnce(
        (args: { where: typeof where }) => {
          where = args.where;
          return Promise.resolve([]);
        },
      );

      await service.purgeGhostRows();

      expect(where?.state).toEqual({
        in: [FileState.expired, FileState.rejected],
      });
      const daysAgo =
        (Date.now() - (where?.updatedAt.lt.getTime() ?? 0)) /
        (24 * 60 * 60 * 1000);
      expect(daysAgo).toBeCloseTo(7, 1);
    });

    it('routes each candidate through purgeTombstone, never touching storage directly', async () => {
      mockPrismaService.file.findMany.mockResolvedValue([
        { id: 'f1' },
        { id: 'f2' },
      ]);

      const count = await service.purgeGhostRows();

      expect(mockDeletionService.purgeTombstone).toHaveBeenCalledWith('f1');
      expect(mockDeletionService.purgeTombstone).toHaveBeenCalledWith('f2');
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      expect(count).toBe(2);
    });

    it('is idempotent: purgeTombstone already swallows a row purged concurrently', async () => {
      mockPrismaService.file.findMany.mockResolvedValue([{ id: 'f1' }]);

      await service.purgeGhostRows();
      await service.purgeGhostRows();

      expect(mockDeletionService.purgeTombstone).toHaveBeenCalledTimes(2);
    });
  });

  describe('reapAbandonedUploads', () => {
    it('selects pending uploads older than the 48-hour window', async () => {
      let where: { state: FileState; createdAt: { lt: Date } } | undefined;
      mockPrismaService.file.findMany.mockImplementationOnce(
        (args: { where: typeof where }) => {
          where = args.where;
          return Promise.resolve([]);
        },
      );

      await service.reapAbandonedUploads();

      expect(where?.state).toBe(FileState.pending);
      const hoursAgo =
        (Date.now() - (where?.createdAt.lt.getTime() ?? 0)) / (60 * 60 * 1000);
      expect(hoursAgo).toBeCloseTo(48, 1);
    });

    it('routes each candidate through deleteFileCompletely, which aborts the multipart', async () => {
      mockPrismaService.file.findMany.mockResolvedValue([{ id: 'f1' }]);

      const count = await service.reapAbandonedUploads();

      expect(mockDeletionService.deleteFileCompletely).toHaveBeenCalledWith(
        'f1',
      );
      expect(count).toBe(1);
    });
  });

  describe('runDailySweep', () => {
    it('runs all three passes and reports their counts', async () => {
      mockPrismaService.file.findMany
        .mockResolvedValueOnce([{ id: 'f1', storageKey: 'uploads/f1' }]) // expire
        .mockResolvedValueOnce([{ id: 'f2' }]) // ghost rows
        .mockResolvedValueOnce([{ id: 'f3' }]); // reaper
      mockPrismaService.file.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.runDailySweep();

      expect(result).toEqual({
        expired: 1,
        ghostRowsPurged: 1,
        abandonedReaped: 1,
      });
    });
  });
});
