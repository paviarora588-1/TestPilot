import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateAutomationPolicyDto {
  @IsOptional()
  @Min(0)
  @Max(1)
  minimumMappingConfidence?: number;

  @IsOptional()
  @Min(0)
  @Max(1)
  maximumAllowedRiskScore?: number;

  @IsOptional()
  @IsBoolean()
  requireAiReviewPass?: boolean;

  @IsOptional()
  @IsBoolean()
  requireKnowledgeProcessed?: boolean;

  @IsOptional()
  @IsBoolean()
  requireObjectVerification?: boolean;

  @IsOptional()
  @IsBoolean()
  qualityWatchEnabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  qualityWatchMaxObjectsPerRun?: number;
}
