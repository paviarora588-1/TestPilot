import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// Every source is independently optional — the only real requirement is that
// at least one of them (or userPrompt) is actually usable, checked in the
// service since it depends on what's actually available in the database.
export class GenerateWithCodexDto {
  @IsInt()
  @Min(1)
  @Max(20)
  @IsOptional()
  count?: number;

  @IsString()
  @IsOptional()
  userPrompt?: string;

  @IsString()
  @IsOptional()
  jiraStoryImportId?: string;

  @IsBoolean()
  @IsOptional()
  includeKnowledgeBase?: boolean;

  @IsBoolean()
  @IsOptional()
  includeZephyr?: boolean;

  // Chains straight through Automation Builder -> Script Generation ->
  // Script Review after the test cases are created, stopping short of
  // execution (see PipelineService#autoAutomate's skipExecution option) —
  // execution itself still requires an explicit, separate manual trigger.
  @IsBoolean()
  @IsOptional()
  chainAutomation?: boolean;
}
