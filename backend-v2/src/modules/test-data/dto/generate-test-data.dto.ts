import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateTestDataDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  testCaseId?: string;

  @IsString()
  @IsOptional()
  environment?: string;

  @IsString()
  @IsOptional()
  focus?: string;

  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  count?: number;
}
