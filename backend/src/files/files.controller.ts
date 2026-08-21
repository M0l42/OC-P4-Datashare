import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilesService } from './files.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { CompleteUploadDto } from './dto/complete-upload.dto';

type AuthedRequest = Request & { user: { userId: string } };

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files/uploads')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  @ApiOperation({ summary: 'Démarrer un téléversement multipart' })
  @ApiResponse({
    status: 201,
    description: 'fileId, taille de partie et URLs pré-signées',
  })
  @ApiResponse({
    status: 400,
    description: 'Extension interdite ou tags en double',
  })
  @ApiResponse({
    status: 413,
    description: 'Taille déclarée supérieure à 1 Gio',
  })
  @Post()
  initiate(@Req() req: AuthedRequest, @Body() dto: InitiateUploadDto) {
    return this.filesService.initiateUpload(req.user.userId, dto);
  }

  @ApiOperation({
    summary: 'Lister les parties déjà envoyées et re-signer les manquantes',
  })
  @ApiResponse({
    status: 200,
    description: 'Parties complétées et URLs des parties manquantes',
  })
  @ApiResponse({
    status: 404,
    description: "Envoi inconnu ou n'appartenant pas à l'utilisateur",
  })
  @ApiResponse({ status: 410, description: 'Multipart expiré côté stockage' })
  @Get(':id/parts')
  getParts(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.filesService.getUploadParts(req.user.userId, id);
  }

  @ApiOperation({ summary: 'Finaliser un téléversement multipart' })
  @ApiResponse({ status: 200, description: 'Fichier finalisé' })
  @ApiResponse({
    status: 404,
    description: "Envoi inconnu ou n'appartenant pas à l'utilisateur",
  })
  @ApiResponse({ status: 409, description: "L'envoi n'est plus en attente" })
  @ApiResponse({ status: 413, description: 'Taille réelle supérieure à 1 Gio' })
  @HttpCode(200)
  @Post(':id/complete')
  complete(
    @Req() req: AuthedRequest,
    @Param('id') id: string,
    @Body() dto: CompleteUploadDto,
  ) {
    return this.filesService.completeUpload(req.user.userId, id, dto);
  }

  @ApiOperation({ summary: 'Annuler un téléversement multipart' })
  @ApiResponse({ status: 204, description: 'Envoi annulé' })
  @ApiResponse({
    status: 404,
    description: "Envoi inconnu ou n'appartenant pas à l'utilisateur",
  })
  @ApiResponse({ status: 409, description: "L'envoi n'est plus en attente" })
  @HttpCode(204)
  @Delete(':id')
  abort(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.filesService.abortUpload(req.user.userId, id);
  }
}
