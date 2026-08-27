import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  NotFoundException,
  PayloadTooLargeException,
} from '@nestjs/common';
import { FileState } from '@prisma/client';
import { FilesService } from './files.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ScanQueueService } from '../scan/scan-queue.service';
import { PART_SIZE_BYTES } from './upload.constants';

describe('FilesService', () => {
  let service: FilesService;
  let mockPrismaService: {
    file: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };
  let mockStorageService: {
    createMultipartUpload: jest.Mock;
    signPartUrls: jest.Mock;
    listParts: jest.Mock;
    completeMultipartUpload: jest.Mock;
    headObject: jest.Mock;
    abortMultipartUpload: jest.Mock;
    deleteObject: jest.Mock;
  };
  let mockScanQueueService: { enqueueValidation: jest.Mock };

  const ownerId = 'owner-1';
  const fileId = 'file-1';

  const pendingFile = {
    id: fileId,
    ownerId,
    state: FileState.pending,
    sizeBytes: 13,
    partSize: PART_SIZE_BYTES,
    storageKey: 'uploads/abc',
    uploadId: 's3-upload-id',
    downloadToken: 'token-abc',
  };

  beforeEach(async () => {
    mockPrismaService = {
      file: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };
    mockStorageService = {
      createMultipartUpload: jest.fn().mockResolvedValue('s3-upload-id'),
      signPartUrls: jest
        .fn()
        .mockImplementation(
          (_key: string, _uploadId: string, partNumbers: number[]) =>
            Promise.resolve(
              partNumbers.map((partNumber) => ({
                partNumber,
                url: `https://signed.example/${partNumber}`,
              })),
            ),
        ),
      listParts: jest.fn(),
      completeMultipartUpload: jest.fn().mockResolvedValue(undefined),
      headObject: jest.fn(),
      abortMultipartUpload: jest.fn().mockResolvedValue(undefined),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    mockScanQueueService = {
      enqueueValidation: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
        { provide: ScanQueueService, useValue: mockScanQueueService },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('initiateUpload', () => {
    const dto = {
      originalName: 'report.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 13,
    };

    it('creates a pending row and returns signed part URLs', async () => {
      let capturedData:
        { state: string; ownerId: string; sizeBytes: number } | undefined;
      mockPrismaService.file.create.mockImplementation(
        (args: { data: typeof capturedData }) => {
          capturedData = args.data;
          return Promise.resolve(pendingFile);
        },
      );

      const result = await service.initiateUpload(ownerId, dto);

      expect(mockStorageService.createMultipartUpload).toHaveBeenCalledWith(
        expect.stringMatching(/^uploads\//),
        dto.mimeType,
      );
      expect(capturedData?.state).toEqual(FileState.pending);
      expect(capturedData?.ownerId).toEqual(ownerId);
      expect(capturedData?.sizeBytes).toEqual(dto.sizeBytes);
      expect(result).toEqual({
        fileId,
        partSize: PART_SIZE_BYTES,
        parts: [{ partNumber: 1, url: 'https://signed.example/1' }],
      });
    });

    it('rejects a blocked extension', async () => {
      await expect(
        service.initiateUpload(ownerId, { ...dto, originalName: 'virus.exe' }),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('rejects a declared size over 1 GiB', async () => {
      await expect(
        service.initiateUpload(ownerId, { ...dto, sizeBytes: 2_000_000_000 }),
      ).rejects.toThrow(PayloadTooLargeException);
      expect(mockStorageService.createMultipartUpload).not.toHaveBeenCalled();
    });

    it('rejects duplicate tags', async () => {
      await expect(
        service.initiateUpload(ownerId, { ...dto, tags: ['a', 'a'] }),
      ).rejects.toThrow(BadRequestException);
      expect(mockStorageService.createMultipartUpload).not.toHaveBeenCalled();
    });
  });

  describe('getUploadParts', () => {
    it('returns completed and missing parts', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.listParts.mockResolvedValue([
        { partNumber: 1, etag: 'etag-1', size: 13 },
      ]);

      const result = await service.getUploadParts(ownerId, fileId);

      expect(result.totalParts).toBe(1);
      expect(result.completedParts).toHaveLength(1);
      expect(result.missingParts).toHaveLength(0);
    });

    it('throws NotFoundException when the upload does not belong to the caller', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(null);

      await expect(service.getUploadParts(ownerId, fileId)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws ConflictException when the upload is no longer pending', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue({
        ...pendingFile,
        state: FileState.ready,
      });

      await expect(service.getUploadParts(ownerId, fileId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('throws GoneException when the storage layer no longer has the multipart upload', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.listParts.mockRejectedValue(
        Object.assign(new Error('gone'), { name: 'NoSuchUpload' }),
      );

      await expect(service.getUploadParts(ownerId, fileId)).rejects.toThrow(
        GoneException,
      );
    });
  });

  describe('completeUpload', () => {
    const dto = { parts: [{ partNumber: 1, etag: 'etag-1' }] };

    it('transitions to uploaded, enqueues validation, and withholds the token', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.headObject.mockResolvedValue({ contentLength: 13 });
      mockPrismaService.file.update.mockResolvedValue({
        ...pendingFile,
        state: FileState.uploaded,
      });

      const result = await service.completeUpload(ownerId, fileId, dto);

      expect(mockStorageService.completeMultipartUpload).toHaveBeenCalled();
      expect(mockPrismaService.file.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { state: FileState.uploaded } }),
      );
      expect(mockScanQueueService.enqueueValidation).toHaveBeenCalledWith(
        fileId,
      );
      // Aucun jeton avant l'état `ready` : un fichier que le scan refusera
      // ensuite ne doit jamais avoir eu de lien partageable.
      expect(result).toEqual({ id: fileId, state: FileState.uploaded });
      expect(result).not.toHaveProperty('downloadToken');
    });

    it('never enqueues validation when the size checks reject the object', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.headObject.mockResolvedValue({ contentLength: 999 });

      await expect(
        service.completeUpload(ownerId, fileId, dto),
      ).rejects.toThrow(BadRequestException);

      expect(mockScanQueueService.enqueueValidation).not.toHaveBeenCalled();
    });

    it('rejects and deletes the object when the real size exceeds 1 GiB', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.headObject.mockResolvedValue({
        contentLength: 2_000_000_000,
      });

      await expect(
        service.completeUpload(ownerId, fileId, dto),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        pendingFile.storageKey,
      );
      expect(mockPrismaService.file.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { state: FileState.rejected, storageKey: null },
        }),
      );
    });

    it('rejects when the real size is smaller than the declared size', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.headObject.mockResolvedValue({ contentLength: 10 });

      await expect(
        service.completeUpload(ownerId, fileId, dto),
      ).rejects.toThrow(BadRequestException);

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        pendingFile.storageKey,
      );
      expect(mockPrismaService.file.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { state: FileState.rejected, storageKey: null },
        }),
      );
    });

    it('rejects when the real size exceeds the declared size but stays under the 1 GiB cap', async () => {
      // Distinct from the "exceeds 1 GiB" case above: this proves the
      // declared-vs-actual check catches a mismatch the absolute-cap check
      // alone would silently accept.
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);
      mockStorageService.headObject.mockResolvedValue({ contentLength: 20 });

      await expect(
        service.completeUpload(ownerId, fileId, dto),
      ).rejects.toThrow(BadRequestException);

      expect(mockStorageService.deleteObject).toHaveBeenCalledWith(
        pendingFile.storageKey,
      );
    });
  });

  describe('abortUpload', () => {
    it('aborts the multipart upload and deletes the row', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(pendingFile);

      await service.abortUpload(ownerId, fileId);

      expect(mockStorageService.abortMultipartUpload).toHaveBeenCalledWith(
        pendingFile.storageKey,
        pendingFile.uploadId,
      );
      expect(mockPrismaService.file.delete).toHaveBeenCalledWith({
        where: { id: fileId },
      });
    });

    it('throws NotFoundException for a non-owned upload', async () => {
      mockPrismaService.file.findFirst.mockResolvedValue(null);

      await expect(service.abortUpload(ownerId, fileId)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
