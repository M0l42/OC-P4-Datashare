import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const mockConfigService = {
      getOrThrow: jest.fn().mockReturnValue('test-secret'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('is defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('carries the userId from the JWT payload into the request user', () => {
      const result = strategy.validate({ userId: 'user-1' });

      expect(result).toEqual({ userId: 'user-1' });
    });
  });
});
