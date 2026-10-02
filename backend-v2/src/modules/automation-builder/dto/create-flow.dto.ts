import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { AutomationFramework } from '../../../../generated/prisma/enums';

export class CreateFlowDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  testCaseId?: string;

  @IsEnum(AutomationFramework)
  @IsOptional()
  framework?: AutomationFramework;
}
