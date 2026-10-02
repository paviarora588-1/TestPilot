import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { IntegrationType } from '../../../../generated/prisma/enums';

export class CreateIntegrationConfigDto {
  @IsEnum(IntegrationType)
  type!: IntegrationType;

  @IsString()
  @MinLength(1)
  baseUrl!: string;

  @IsString()
  @IsOptional()
  projectKey?: string;

  @IsString()
  @MinLength(1)
  apiToken!: string;

  @IsString()
  @IsOptional()
  email?: string;
}
