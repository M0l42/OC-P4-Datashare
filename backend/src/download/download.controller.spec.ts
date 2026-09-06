import { Test, TestingModule } from '@nestjs/testing';
import { DownloadController } from './download.controller';
import { DownloadService } from './download.service';
import { DownloadThrottlerGuard } from './download-throttler.guard';

describe('DownloadController', () => {
  let controller: DownloadController;
  let mockDownloadService: {
    getMetadata: jest.Mock;
    verifyPasswordAndGetUrl: jest.Mock;
  };
  let mockRes: { status: jest.Mock };

  beforeEach(async () => {
    mockDownloadService = {
      getMetadata: jest.fn(),
      verifyPasswordAndGetUrl: jest.fn(),
    };
    mockRes = { status: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DownloadController],
      providers: [{ provide: DownloadService, useValue: mockDownloadService }],
    })
      // Le contrôleur porte @UseGuards(DownloadThrottlerGuard) au niveau
      // classe — sans cette substitution, la compilation du module tente de
      // résoudre les dépendances réelles du guard (stockage Redis, Prisma)
      // alors que ces tests n'appellent jamais les méthodes du contrôleur
      // via HTTP.
      .overrideGuard(DownloadThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<DownloadController>(DownloadController);
  });

  describe('getMetadata', () => {
    it('answers 200 with metadata only, never a download URL, when the file is ready', async () => {
      mockDownloadService.getMetadata.mockResolvedValue({
        status: 'ready',
        metadata: { originalName: 'report.pdf', sizeBytes: 42 },
      });

      const result = await controller.getMetadata('tok-1', mockRes as never);

      expect(mockDownloadService.getMetadata).toHaveBeenCalledWith('tok-1');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(result).toEqual({
        originalName: 'report.pdf',
        sizeBytes: 42,
      });
      expect(result).not.toHaveProperty('downloadUrl');
    });

    it('answers 202 with metadata only while still scanning', async () => {
      mockDownloadService.getMetadata.mockResolvedValue({
        status: 'scanning',
        metadata: { originalName: 'report.pdf' },
      });

      const result = await controller.getMetadata('tok-1', mockRes as never);

      expect(mockRes.status).toHaveBeenCalledWith(202);
      expect(result).not.toHaveProperty('downloadUrl');
    });
  });

  describe('requestDownloadUrl', () => {
    it('delegates the token and password to the service', () => {
      mockDownloadService.verifyPasswordAndGetUrl.mockResolvedValue({
        downloadUrl: 'https://signed.example/report.pdf',
      });

      controller.requestDownloadUrl('tok-1', { password: 'secret6' });

      expect(mockDownloadService.verifyPasswordAndGetUrl).toHaveBeenCalledWith(
        'tok-1',
        'secret6',
      );
    });
  });
});
