import { Test, TestingModule } from '@nestjs/testing';
import {
  GoneException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { FileState } from '@prisma/client';
import { DownloadService } from './download.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

describe('DownloadService', () => {
  let service: DownloadService;
  let mockPrismaService: { file: { findUnique: jest.Mock } };
  let mockStorageService: { signDownloadUrl: jest.Mock };

  const token = 'token-abc';

  const baseFile = {
    id: 'file-1',
    originalName: 'report.pdf',
    sizeBytes: 13,
    mimeType: 'application/pdf',
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    passwordHash: null as string | null,
    showSender: false,
    storageKey: 'uploads/abc',
    state: FileState.ready,
    owner: { displayName: 'Nathan' },
  };

  beforeEach(async () => {
    mockPrismaService = { file: { findUnique: jest.fn() } };
    mockStorageService = {
      signDownloadUrl: jest
        .fn()
        .mockResolvedValue('https://signed.example/download'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DownloadService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: StorageService, useValue: mockStorageService },
      ],
    }).compile();

    service = module.get<DownloadService>(DownloadService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getMetadata', () => {
    it('returns metadata and a download URL when ready with no password', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue(baseFile);

      const result = await service.getMetadata(token);

      expect(result.status).toBe('ready');
      expect(result.downloadUrl).toBe('https://signed.example/download');
      expect(result.metadata.passwordRequired).toBe(false);
      expect(result.metadata.senderName).toBeUndefined();
    });

    it('returns metadata without a download URL when ready with a password', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        passwordHash: 'hashed',
      });

      const result = await service.getMetadata(token);

      expect(result.status).toBe('ready');
      expect(result.downloadUrl).toBeUndefined();
      expect(result.metadata.passwordRequired).toBe(true);
      expect(mockStorageService.signDownloadUrl).not.toHaveBeenCalled();
    });

    it('includes the sender name only when show_sender is set', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        showSender: true,
      });

      const result = await service.getMetadata(token);

      expect(result.metadata.senderName).toBe('Nathan');
    });

    it('returns a scanning status without a download URL', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        state: FileState.scanning,
      });

      const result = await service.getMetadata(token);

      expect(result.status).toBe('scanning');
      expect(result.downloadUrl).toBeUndefined();
      expect(mockStorageService.signDownloadUrl).not.toHaveBeenCalled();
    });

    it('throws GoneException when the file has expired', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        state: FileState.expired,
      });

      await expect(service.getMetadata(token)).rejects.toThrow(GoneException);
    });

    it('throws GoneException when the row is still ready but past its expiry date', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.getMetadata(token)).rejects.toThrow(GoneException);
    });

    it('throws NotFoundException with an identical message for an unknown token, rejected, and abandoned files', async () => {
      mockPrismaService.file.findUnique.mockResolvedValueOnce(null);
      await expect(service.getMetadata(token)).rejects.toThrow(
        NotFoundException,
      );

      mockPrismaService.file.findUnique.mockResolvedValueOnce({
        ...baseFile,
        state: FileState.rejected,
      });
      await expect(service.getMetadata(token)).rejects.toThrow(
        NotFoundException,
      );

      mockPrismaService.file.findUnique.mockResolvedValueOnce({
        ...baseFile,
        state: FileState.abandoned,
      });
      await expect(service.getMetadata(token)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('verifyPasswordAndGetUrl', () => {
    it('returns a download URL for the correct password', async () => {
      const passwordHash = await bcrypt.hash('secret', 10);
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        passwordHash,
      });

      const result = await service.verifyPasswordAndGetUrl(token, 'secret');

      expect(result.downloadUrl).toBe('https://signed.example/download');
    });

    it('throws UnauthorizedException for an incorrect password', async () => {
      const passwordHash = await bcrypt.hash('secret', 10);
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        passwordHash,
      });

      await expect(
        service.verifyPasswordAndGetUrl(token, 'wrong'),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('throws UnauthorizedException when no password is supplied but one is required', async () => {
      const passwordHash = await bcrypt.hash('secret', 10);
      mockPrismaService.file.findUnique.mockResolvedValue({
        ...baseFile,
        passwordHash,
      });

      await expect(
        service.verifyPasswordAndGetUrl(token, undefined),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('returns a download URL when no password is set, regardless of what was sent', async () => {
      mockPrismaService.file.findUnique.mockResolvedValue(baseFile);

      const result = await service.verifyPasswordAndGetUrl(token, undefined);

      expect(result.downloadUrl).toBe('https://signed.example/download');
    });
  });
});
