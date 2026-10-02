import { IsInt, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class AnalyzeStoryDto {
  @IsString()
  @MinLength(1)
  issueKey!: string;

  @IsInt()
  @Min(1)
  @Max(15)
  @IsOptional()
  count?: number;
}
