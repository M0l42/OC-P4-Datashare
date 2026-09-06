import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

describe('AuthService', () => {
  let service: AuthService;
  let mockPrismaService: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
    };
  };
  let mockJwtService: {
    signAsync: jest.Mock;
  };

  beforeEach(async () => {
    mockPrismaService = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    mockJwtService = {
      signAsync: jest.fn().mockResolvedValue('fake-jwt-token'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: JwtService, useValue: mockJwtService },
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
    mockPrismaService.user.findUnique.mockResolvedValue({
      id: 'whatever',
      email: dto.email,
    });

    await expect(service.register(dto)).rejects.toThrow('Email already in use');
  });

  it('should login a user with valid credentials', async () => {
    const dto = {
      email: 'test@example.com',
      password: '123456',
    };
    const mockUser = {
      id: 'fake-id',
      email: dto.email,
      passwordHash: await bcrypt.hash(dto.password, 10),
    };
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

    const result = await service.login(dto);
    expect(result.user.email).toEqual(mockUser.email);
    expect(result).toHaveProperty('token');
  });

  it('should throw an error if user does not exist', async () => {
    const dto = {
      email: 'nonexistent@example.com',
      password: '123456',
    };
    mockPrismaService.user.findUnique.mockResolvedValue(null);

    await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
  });

  it('should throw an error if password is invalid', async () => {
    const dto = {
      email: 'test@example.com',
      password: 'wrongpassword',
    };
    const mockUser = {
      id: 'fake-id',
      email: dto.email,
      passwordHash: await bcrypt.hash('123456', 10),
    };
    mockPrismaService.user.findUnique.mockResolvedValue(mockUser);

    await expect(service.login(dto)).rejects.toThrow('Invalid credentials');
  });
});
