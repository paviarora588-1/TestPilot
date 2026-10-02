import { Module } from '@nestjs/common';
import { RagModule } from '../rag/rag.module';
import { JiraCodexImportController } from './jira-codex-import.controller';
import { JiraCodexImportService } from './jira-codex-import.service';

@Module({
  imports: [RagModule],
  controllers: [JiraCodexImportController],
  providers: [JiraCodexImportService],
})
export class JiraCodexImportModule {}
