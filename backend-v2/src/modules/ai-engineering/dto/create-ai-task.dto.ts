import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { BugSeverity } from '../../../../generated/prisma/enums';

export class CreateAiTaskDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @MinLength(1)
  description!: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  reproSteps?: string[];

  @IsEnum(BugSeverity)
  @IsOptional()
  severity?: BugSeverity;
}
