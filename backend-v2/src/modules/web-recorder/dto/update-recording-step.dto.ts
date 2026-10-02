import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateRecordingStepDto {
  @IsString()
  @IsOptional()
  label?: string;

  @IsBoolean()
  @IsOptional()
  isVariable?: boolean;

  @IsString()
  @IsOptional()
  variableName?: string;

  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;
}
