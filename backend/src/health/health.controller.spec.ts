import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PrismaService } from '../prisma/prisma.service';

describe('HealthController', () => {
  let controller: HealthController;
  let mockPrismaService: { $queryRaw: jest.Mock };

  beforeEach(async () => {
    mockPrismaService = { $queryRaw: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: mockPrismaService }],
    }).compile();

    controller = module.get<HealthController>(HealthController);
  });

  describe('liveness', () => {
    it('reports ok without touching the database', () => {
      const result = controller.liveness();

      expect(result.status).toBe('ok');
      expect(typeof result.uptime).toBe('number');
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('reports ready when the database answers', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);

      await expect(controller.readiness()).resolves.toEqual({
        status: 'ready',
        database: 'up',
      });
    });

    it('throws 503 when the database is unreachable', async () => {
      mockPrismaService.$queryRaw.mockRejectedValue(new Error('connection refused'));

      await expect(controller.readiness()).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });
});
