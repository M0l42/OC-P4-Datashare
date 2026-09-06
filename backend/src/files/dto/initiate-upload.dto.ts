import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import {
  DEFAULT_EXPIRY_DAYS,
  MAX_EXPIRY_DAYS,
  MAX_TAG_LENGTH,
  MIN_DOWNLOAD_PASSWORD_LENGTH,
} from '../upload.constants';

export class InitiateUploadDto {
  @IsString()
  @MaxLength(255)
  originalName: string;

  @IsString()
  @MaxLength(127)
  mimeType: string;

  @IsInt()
  @IsPositive()
  sizeBytes: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_EXPIRY_DAYS,
    default: DEFAULT_EXPIRY_DAYS,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_EXPIRY_DAYS)
  expiresInDays?: number;

  @ApiPropertyOptional({ minLength: MIN_DOWNLOAD_PASSWORD_LENGTH })
  @IsOptional()
  @IsString()
  @MinLength(MIN_DOWNLOAD_PASSWORD_LENGTH)
  password?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @MaxLength(MAX_TAG_LENGTH, { each: true })
  tags?: string[];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  showSender?: boolean;
}
