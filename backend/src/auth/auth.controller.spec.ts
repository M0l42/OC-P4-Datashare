import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  let controller: AuthController;
  let mockAuthService: {
    register: jest.Mock;
    login: jest.Mock;
  };

  beforeEach(async () => {
    mockAuthService = {
      register: jest.fn(),
      login: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: mockAuthService }],
    })
      // Le contrôleur porte @UseGuards(ThrottlerGuard) — sans cette
      // substitution, la compilation du module tente de résoudre les
      // dépendances réelles du guard (stockage Redis) alors que ces tests
      // n'appellent jamais les méthodes du contrôleur via HTTP.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('register() delegates to AuthService.register with the dto', async () => {
    const dto = { email: 'test@example.com', password: '12345678' };
    const expected = {
      id: 'fake-id',
      email: dto.email,
      displayName: null,
      createdAt: new Date(),
    };
    mockAuthService.register.mockResolvedValue(expected);

    const result = await controller.register(dto);

    expect(mockAuthService.register).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('login() delegates to AuthService.login with the dto', async () => {
    const dto = { email: 'test@example.com', password: '12345678' };
    const expected = {
      user: { id: 'fake-id', email: dto.email },
      token: 'fake-jwt-token',
    };
    mockAuthService.login.mockResolvedValue(expected);

    const result = await controller.login(dto);

    expect(mockAuthService.login).toHaveBeenCalledWith(dto);
    expect(result).toBe(expected);
  });

  it('me() returns the authenticated user carried on the request by JwtAuthGuard', () => {
    const req = { user: { userId: 'fake-id' } } as any;

    const result = controller.me(req);

    expect(result).toEqual({ userId: 'fake-id' });
  });
});
