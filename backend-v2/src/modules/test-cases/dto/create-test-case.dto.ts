import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsOptional, IsString, MinLength, ValidateNested } from 'class-validator';
import { TestCasePriority } from '../../../../generated/prisma/enums';

export class TestStepInputDto {
  @IsString()
  @MinLength(1)
  instruction!: string;

  @IsString()
  @IsOptional()
  expectedResult?: string;
}

export class CreateTestCaseDto {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsString()
  @IsOptional()
  moduleName?: string;

  @IsString()
  @IsOptional()
  featureName?: string;

  @IsEnum(TestCasePriority)
  @IsOptional()
  priority?: TestCasePriority;

  @IsString()
  @IsOptional()
  preconditions?: string;

  @IsString()
  @IsOptional()
  expectedResult?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TestStepInputDto)
  @IsOptional()
  steps?: TestStepInputDto[];
}
