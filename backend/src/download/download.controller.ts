import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { DownloadService } from './download.service';
import { VerifyPasswordDto } from './dto/verify-password.dto';
import { DownloadThrottlerGuard } from './download-throttler.guard';

// Non authentifié par conception (diagramme 5) : la possession du jeton
// dans l'URL est la seule autorisation. dlToken/dlTokenPassword/dlIp :
// voir throttler/throttler.module.ts. L'URL de téléchargement n'est jamais
// rendue par le GET, avec ou sans mot de passe (diagramme 5b) : elle n'existe
// que derrière le clic explicite sur Télécharger, pour ne pas la donner à un
// robot d'indexation ou un aperçu de lien qui charge juste la page.
@ApiTags('download')
@Controller('d')
@UseGuards(DownloadThrottlerGuard)
@Throttle({ dlIp: { limit: 100, ttl: 60_000 }, dlToken: { limit: 60, ttl: 120_000 } })
@SkipThrottle({ authLogin: true, authRegister: true, dlTokenPassword: true })
export class DownloadController {
  constructor(private readonly downloadService: DownloadService) {}

  @ApiOperation({ summary: 'Métadonnées avant téléchargement' })
  @ApiResponse({
    status: 200,
    description: 'Fichier prêt, aucune URL rendue ici',
  })
  @ApiResponse({ status: 202, description: 'Analyse en cours' })
  @ApiResponse({
    status: 404,
    description:
      'Lien invalide (jeton inconnu, refusé ou abandonné — réponse identique dans les trois cas)',
  })
  @ApiResponse({ status: 410, description: 'Fichier expiré' })
  @ApiResponse({ status: 429, description: 'Trop de requêtes' })
  @Get(':token')
  async getMetadata(
    @Param('token') token: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.downloadService.getMetadata(token);
    res.status(result.status === 'ready' ? 200 : 202);
    return result.metadata;
  }

  @ApiOperation({
    summary: 'Obtenir une URL de téléchargement (clic sur Télécharger)',
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
  @ApiResponse({ status: 429, description: 'Trop de tentatives de mot de passe' })
  // Compteur dédié, plus strict que dlToken (voir throttler.module.ts) ;
  // DownloadThrottlerGuard le désactive quand le fichier n'a pas de mot de
  // passe, puisqu'il n'y a alors rien à brute-forcer.
  @SkipThrottle({ dlToken: true, dlTokenPassword: false })
  @Throttle({ dlTokenPassword: { limit: 6, ttl: 120_000 } })
  @HttpCode(200)
  @Post(':token')
  requestDownloadUrl(
    @Param('token') token: string,
    @Body() dto: VerifyPasswordDto,
  ) {
    return this.downloadService.verifyPasswordAndGetUrl(token, dto.password);
  }
}
