import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class GenerateTestCasesDto {
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  count?: number;

  @IsString()
  @IsOptional()
  focus?: string;

  @IsBoolean()
  @IsOptional()
  autoGenerateFlows?: boolean;
}
