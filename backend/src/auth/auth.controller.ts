import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @ApiOperation({ summary: 'Créer un compte' })
  @ApiResponse({ status: 201, description: 'Compte créé' })
  @ApiResponse({ status: 409, description: 'Email déjà utilisé' })
  @Post('register')
  register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @ApiOperation({ summary: 'Se connecter' })
  @ApiResponse({ status: 200, description: 'Jeton JWT émis' })
  @ApiResponse({ status: 401, description: 'Identifiants invalides' })
  @Post('login')
  @HttpCode(200)
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @ApiBearerAuth()
  @ApiOperation({ summary: 'Utilisateur courant' })
  @ApiResponse({ status: 200, description: 'Identité résolue depuis le JWT' })
  @ApiResponse({ status: 401, description: 'JWT manquant ou invalide' })
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: Request & { user: { userId: string } }) {
    return req.user;
  }
}
