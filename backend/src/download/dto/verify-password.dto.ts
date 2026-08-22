import { IsOptional, IsString } from 'class-validator';

export class VerifyPasswordDto {
  @IsOptional()
  @IsString()
  password?: string;
}
