import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrismaService: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };

  beforeEach(async () => {
    mockPrismaService = {
        user: {
            findUnique: jest.fn(),
            create: jest.fn(),
        },
    };



    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);

  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should register a new user', async () => {
    const dto = {
      email: 'test@example.com',
      password: '123456',
    };
    const mockUser = {
      id: 1,
      email: dto.email,
    };

    mockPrismaService.user.create.mockResolvedValue({
      id: 'fake-id',
      email: dto.email,
      passwordHash: 'irrelevant-here',
      displayName: null,
      createdAt: new Date(),
    });

    const result = await service.register(dto);
    expect(result.email).toEqual(mockUser.email);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('should throw an error if email is already in use', async () => {
    const dto = {
      email: 'test@example.com',
      password: '123456',
    };
    mockPrismaService.user.findUnique.mockResolvedValue({ id: 'whatever', email: dto.email });

    await expect(service.register(dto)).rejects.toThrow('Email already in use');
  });
});
