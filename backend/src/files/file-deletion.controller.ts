import {
  Controller,
  Delete,
  HttpCode,
  Param,
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
import { FileDeletionService } from './file-deletion.service';

type AuthedRequest = Request & { user: { userId: string } };

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FileDeletionController {
  constructor(private readonly fileDeletion: FileDeletionService) {}

  @ApiOperation({
    summary: 'Supprimer un fichier (Mon espace)',
    description:
      "Supprime la ligne et, si un objet existe encore en stockage, l'objet " +
      "(ou avorte le multipart s'il est encore en vol). Idempotent : un " +
      'second appel sur un fichier déjà supprimé renvoie 404, jamais 500.',
  })
  @ApiResponse({ status: 204, description: 'Fichier supprimé' })
  @ApiResponse({
    status: 404,
    description: "Fichier inconnu ou n'appartenant pas à l'utilisateur",
  })
  @HttpCode(204)
  @Delete(':id')
  remove(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.fileDeletion.deleteOwnedFile(req.user.userId, id);
  }
}
