import { IsEnum, IsOptional, IsString, IsUrl, MinLength } from 'class-validator';
import { ApplicationType, AutomationFramework } from '../../../../generated/prisma/enums';

export class CreateApplicationDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsEnum(ApplicationType)
  @IsOptional()
  appType?: ApplicationType;

  @IsString()
  @IsOptional()
  environment?: string;

  @IsUrl({ require_tld: false })
  @IsOptional()
  entryUrl?: string;

  @IsString()
  @IsOptional()
  entryTransactionCode?: string;

  @IsEnum(AutomationFramework)
  @IsOptional()
  defaultFramework?: AutomationFramework;

  @IsString()
  @IsOptional()
  owner?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  businessCriticality?: string;

  @IsString()
  @IsOptional()
  automationRiskLevel?: string;
}
