import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FilesService } from './files.service';
import { ListFilesQueryDto } from './dto/list-files-query.dto';

type AuthedRequest = Request & { user: { userId: string } };

@ApiTags('files')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('files')
export class FileHistoryController {
  constructor(private readonly filesService: FilesService) {}

  @ApiOperation({
    summary: 'Historique des fichiers du propriétaire (Mon espace)',
  })
  @ApiResponse({
    status: 200,
    description:
      'Fichiers ready/expired/rejected, filtrés au propriétaire, du plus récent au plus ancien',
  })
  @Get()
  list(@Req() req: AuthedRequest, @Query() query: ListFilesQueryDto) {
    return this.filesService.listFiles(req.user.userId, query.filter);
  }
}
