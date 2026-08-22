import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DownloadService } from './download.service';
import { VerifyPasswordDto } from './dto/verify-password.dto';

// Non authentifié par conception (diagramme 5) : la seule autorisation est la
// possession du jeton dans l'URL.
@ApiTags('download')
@Controller('d')
export class DownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  @ApiOperation({ summary: 'Métadonnées avant téléchargement' })
  @ApiResponse({
    status: 200,
    description: 'Fichier prêt ; URL incluse si aucun mot de passe',
  })
  @ApiResponse({ status: 202, description: 'Analyse en cours' })
  @ApiResponse({
    status: 404,
    description:
      'Lien invalide (jeton inconnu, refusé ou abandonné — réponse identique dans les trois cas)',
  })
  @ApiResponse({ status: 410, description: 'Fichier expiré' })
  @Get(':token')
  async getMetadata(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.downloadService.getMetadata(token);
    res.status(result.status === 'ready' ? 200 : 202);
    return { ...result.metadata, downloadUrl: result.downloadUrl };
  }

  @ApiOperation({
    summary: 'Vérifier le mot de passe et obtenir une URL de téléchargement',
  })
  @ApiResponse({
    status: 200,
    description: 'URL pré-signée, valable 60 secondes',
  })
  @ApiResponse({ status: 401, description: 'Mot de passe incorrect' })
  @ApiResponse({ status: 404, description: 'Lien invalide' })
  @ApiResponse({
    status: 410,
    description: 'Fichier expiré ou toujours en analyse',
  })
  @HttpCode(200)
  @Post(':token')
  verifyPassword(
    @Param('token') token: string,
    @Body() dto: VerifyPasswordDto,
  ) {
    return this.downloadService.verifyPasswordAndGetUrl(token, dto.password);
  }
}
