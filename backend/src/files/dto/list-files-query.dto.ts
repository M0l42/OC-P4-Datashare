import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export type HistoryFilter = 'all' | 'active' | 'expired';

export class ListFilesQueryDto {
  @ApiPropertyOptional({
    enum: ['all', 'active', 'expired'],
    default: 'all',
    description:
      "Tous/Actifs/Expiré. « all » inclut aussi rejected, qui n'a pas son " +
      'propre onglet.',
  })
  @IsOptional()
  @IsIn(['all', 'active', 'expired'])
  filter?: HistoryFilter;
}
