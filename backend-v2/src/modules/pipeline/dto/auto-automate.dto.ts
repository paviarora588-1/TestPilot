import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsString } from 'class-validator';

export class AutoAutomateDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(25)
  @IsString({ each: true })
  testCaseIds!: string[];

  // Which engine drafts the automation flow for each test case — defaults
  // to the local AI provider (existing behavior); 'CODEX' routes flow
  // generation through Codex CLI instead (admin-only in practice, since the
  // frontend only exposes this toggle to admins).
  @IsIn(['LOCAL', 'CODEX'])
  @IsOptional()
  engine?: 'LOCAL' | 'CODEX';
}
