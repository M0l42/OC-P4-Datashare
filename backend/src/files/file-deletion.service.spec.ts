import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FileState } from '@prisma/client';
import { FileDeletionService } from './file-deletion.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('FileDeletionService', () => {
  let service: FileDeletionService;
  let mockPrismaService: {
    file: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mockStorageService: {
    abortMultipartUpload: jest.Mock;
    deleteObject: jest.Mock;
  };

  const ownerId = 'owner-1';
  const fileId = 'file-1';

  const readyFile = {
    id: fileId,
    ownerId,
    state: FileState.ready,
    storageKey: 'uploads/abc',
    uploadId: null,
  };
  const pendingFile = {
    id: fileId,
    ownerId,
    state: FileState.pending,
    storageKey: 'uploads/abc',
    uploadId: 's3-upload-id',
  };
  const expiredFile = {
    id: fileId,
    ownerId,
    state: FileState.expired,
    storageKey: null,
    uploadId: null,
  };

  beforeEach(async () => {
    mockPrismaService = {
      file: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    mockStorageService = {
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FileDeletionService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<FileDeletionService>(FileDeletionService);
  });

  describe('deleteOwnedFile', () => {
    it('throws NotFoundException when the file does not belong to the caller', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(null);

      await expect(service.deleteOwnedFile(ownerId, fileId)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
    });

    it('deletes the object and the row for a ready file', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(readyFile);
      mockPrismaService.file.findUnique.mockResolvedValue(readyFile);

      await service.deleteOwnedFile(ownerId, fileId);

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        readyFile.storageKey,
      );
      expect(mockStorageService.abortMultipartUpload).not.toHaveBeenCalled();
      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: fileId },
      });
    });

    it('allows deleting a file that is currently being scanned', async () => {
      const scanningFile = { ...readyFile, state: FileState.scanning };
      mockPrismaService.file.findFirst.mockResolvedValue(scanningFile);
      mockPrismaService.file.findUnique.mockResolvedValue(scanningFile);

      await service.deleteOwnedFile(ownerId, fileId);

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        scanningFile.storageKey,
      );
      expect(mockPrismaService.file.delete).toHaveBeenCalled();
    });

    it('aborts the multipart upload instead of deleting an object for a pending file', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockPrismaService.file.findUnique.mockResolvedValue(pendingFile);

      await service.deleteOwnedFile(ownerId, fileId);

      expect(mockStorageService.abortMultipartUpload).toHaveBeenCalledWith(
        pendingFile.storageKey,
        pendingFile.uploadId,
      );
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      expect(mockPrismaService.file.delete).toHaveBeenCalled();
    });

    it('routes an expired tombstone through purgeTombstone and never touches storage', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(expiredFile);
      const purgeSpy = jest.spyOn(service, 'purgeTombstone');

      await service.deleteOwnedFile(ownerId, fileId);

      expect(purgeSpy).toHaveBeenCalledWith(fileId);
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      expect(mockStorageService.abortMultipartUpload).not.toHaveBeenCalled();
      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: fileId },
      });
    });
  });

  describe('deleteFileCompletely', () => {
    it('is a no-op when the file is already gone', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue(null);

      await service.deleteFileCompletely(fileId);

      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      expect(mockPrismaService.file.delete).not.toHaveBeenCalled();
    });

    it('swallows a NoSuchUpload race on abort instead of throwing', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue(pendingFile);
      mockStorageService.abortMultipartUpload.mockRejectedValue(
        Object.assign(new Error('gone'), { name: 'NoSuchUpload' }),
      );

      await expect(
        service.deleteFileCompletely(fileId),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.file.delete).toHaveBeenCalled();
    });

    it('re-throws an unrelated storage error', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue(readyFile);
      mockStorageService.deleteObject.mockRejectedValue(new Error('network'));

      await expect(service.deleteFileCompletely(fileId)).rejects.toThrow(
        'network',
      );
      expect(mockPrismaService.file.delete).not.toHaveBeenCalled();
    });

    it('swallows a "record not found" race on the row delete (double click / concurrent purge)', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue(readyFile);
      mockPrismaService.file.delete.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'P2025' }),
      );

      await expect(
        service.deleteFileCompletely(fileId),
      ).resolves.toBeUndefined();
    });
  });

  describe('purgeTombstone', () => {
    it('deletes only the row, never storage', async () => {
      await service.purgeTombstone(fileId);

      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: fileId },
      });
      expect(mockStorageService.deleteObject).not.toHaveBeenCalled();
      expect(mockStorageService.abortMultipartUpload).not.toHaveBeenCalled();
    });

    it('is idempotent against a row already purged concurrently', async () => {
      mockPrismaService.file.delete.mockRejectedValue(
        Object.assign(new Error('not found'), { code: 'P2025' }),
      );

      await expect(service.purgeTombstone(fileId)).resolves.toBeUndefined();
    });
  });
});
