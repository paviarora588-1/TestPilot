import { IsArray, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { BugSeverity, TestCasePriority } from '../../../../generated/prisma/enums';

export class UpdateBugReportDto {
  @IsString()
  @MinLength(1)
  @IsOptional()
  title?: string;

  @IsArray()
  @IsOptional()
  stepsToReproduce?: string[];

  @IsString()
  @IsOptional()
  actualResult?: string;

  @IsString()
  @IsOptional()
  expectedResult?: string;

  @IsEnum(BugSeverity)
  @IsOptional()
  severity?: BugSeverity;

  @IsEnum(TestCasePriority)
  @IsOptional()
  priority?: TestCasePriority;

  @IsString()
  @IsOptional()
  environment?: string;
}
