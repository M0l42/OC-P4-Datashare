import { Test, TestingModule } from '@nestjs/testing';
import { FileState } from '@prisma/client';
import { ValidationService } from './validation.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { ClamAvClient } from './clamav.client';
import { CLAMAV_MAX_SCAN_BYTES, MAGIC_BYTES_RANGE_END } from './scan.constants';

// En-têtes réels : %PDF pour un PDF valide, MZ pour un exécutable Windows.
const PDF_HEAD = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
const MZ_HEAD = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

describe('ValidationService', () => {
  let service: ValidationService;
  let mockPrisma: { file: { findUnique: jest.Mock; update: jest.Mock } };
  let mockStorage: {
    getObjectRange: jest.Mock;
    getObjectFull: jest.Mock;
    deleteObject: jest.Mock;
  };
  let mockClamAv: { scanBuffer: jest.Mock };

  const fileId = 'file-1';
  const baseFile = {
    id: fileId,
    originalName: 'report.pdf',
    storageKey: 'uploads/abc',
    sizeBytes: 1_000,
    state: FileState.uploaded,
  };

  beforeEach(async () => {
    mockPrisma = {
      file: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) },
    };
    mockStorage = {
      getObjectRange: jest.fn().mockResolvedValue(PDF_HEAD),
      getObjectFull: jest.fn().mockResolvedValue(Buffer.from('clean content')),
      deleteObject: jest.fn().mockResolvedValue(undefined),
    };
    mockClamAv = { scanBuffer: jest.fn().mockResolvedValue({ kind: 'clean' }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValidationService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: StorageService, useValue: mockStorage },
        { provide: ClamAvClient, useValue: mockClamAv },
      ],
    }).compile();

    service = module.get<ValidationService>(ValidationService);
  });

  it('claims the row by setting scanning before doing any work', async () => {
    mockPrisma.file.findUnique.mockResolvedValue(baseFile);

    await service.validate(fileId);

    // Poser `scanning` au démarrage du job est ce qui rend un worker mort
    // détectable : sans ça, la remise en file à 15 min n'a rien à observer.
    expect(mockPrisma.file.update).toHaveBeenNthCalledWith(1, {
      where: { id: fileId },
      data: { state: FileState.scanning },
    });
  });

  describe('magic bytes (stage 1)', () => {
    it('rejects a spoofed extension WITHOUT ever reading the full object', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(baseFile);
      mockStorage.getObjectRange.mockResolvedValue(MZ_HEAD); // .pdf annoncé, MZ réel

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({
        kind: 'rejected',
        reason: 'extension usurpée (.pdf)',
      });
      // Le cœur du critère d'acceptation : aucune lecture complète.
      expect(mockStorage.getObjectFull).not.toHaveBeenCalled();
      expect(mockClamAv.scanBuffer).not.toHaveBeenCalled();
      expect(mockStorage.deleteObject).toHaveBeenCalledWith(
        baseFile.storageKey,
      );
    });

    it('reads only the first 64 bytes for the magic-byte check', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(baseFile);

      await service.validate(fileId);

      expect(mockStorage.getObjectRange).toHaveBeenCalledWith(
        baseFile.storageKey,
        MAGIC_BYTES_RANGE_END,
      );
    });

    it('lets an unverifiable extension through to the virus scan', async () => {
      mockPrisma.file.findUnique.mockResolvedValue({
        ...baseFile,
        originalName: 'notes.txt', // aucune signature connue
      });
      mockStorage.getObjectRange.mockResolvedValue(Buffer.from('plain text'));

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({ kind: 'ready' });
      expect(mockClamAv.scanBuffer).toHaveBeenCalled();
    });
  });

  describe('ClamAV (stage 2)', () => {
    it('rejects an infected file and deletes the object', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(baseFile);
      mockClamAv.scanBuffer.mockResolvedValue({
        kind: 'infected',
        signature: 'Eicar-Test-Signature',
      });

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({
        kind: 'rejected',
        reason: 'logiciel malveillant détecté (Eicar-Test-Signature)',
      });
      expect(mockStorage.deleteObject).toHaveBeenCalledWith(
        baseFile.storageKey,
      );
      expect(mockPrisma.file.update).toHaveBeenLastCalledWith({
        where: { id: fileId },
        data: { state: FileState.rejected, storageKey: null },
      });
    });

    it('marks a clean file ready', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(baseFile);

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({ kind: 'ready' });
      expect(mockPrisma.file.update).toHaveBeenLastCalledWith({
        where: { id: fileId },
        data: { state: FileState.ready },
      });
    });

    it('skips the scan above the 50 MB cap WITHOUT any full read', async () => {
      mockPrisma.file.findUnique.mockResolvedValue({
        ...baseFile,
        sizeBytes: CLAMAV_MAX_SCAN_BYTES + 1,
      });

      const outcome = await service.validate(fileId);

      // Le fichier devient `ready`, mais l'objet n'est jamais entièrement
      // retiré de MinIO : c'est exactement l'économie d'egress que le
      // plafond existe pour produire.
      expect(outcome).toEqual({ kind: 'ready' });
      expect(mockStorage.getObjectFull).not.toHaveBeenCalled();
      expect(mockClamAv.scanBuffer).not.toHaveBeenCalled();
    });
  });

  describe('job robustness', () => {
    it('skips a file that no longer exists', async () => {
      mockPrisma.file.findUnique.mockResolvedValue(null);

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({
        kind: 'skipped',
        reason: 'file no longer exists',
      });
      expect(mockPrisma.file.update).not.toHaveBeenCalled();
    });

    it('skips a file that already left the uploaded/scanning states', async () => {
      mockPrisma.file.findUnique.mockResolvedValue({
        ...baseFile,
        state: FileState.ready,
      });

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({ kind: 'skipped', reason: 'state is ready' });
      expect(mockStorage.getObjectRange).not.toHaveBeenCalled();
    });

    it('re-processes a file already claimed as scanning (dead-worker requeue)', async () => {
      mockPrisma.file.findUnique.mockResolvedValue({
        ...baseFile,
        state: FileState.scanning,
      });

      const outcome = await service.validate(fileId);

      expect(outcome).toEqual({ kind: 'ready' });
    });
  });
});
