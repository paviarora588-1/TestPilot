import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AiProviderModule } from './modules/ai-provider/ai-provider.module';
import { ApplicationsModule } from './modules/applications/applications.module';
import { AuthModule } from './modules/auth/auth.module';
import { ObjectLibraryModule } from './modules/object-library/object-library.module';
import { ScannerModule } from './modules/scanner/scanner.module';
import { AutomationBuilderModule } from './modules/automation-builder/automation-builder.module';
import { ScriptGeneratorModule } from './modules/script-generator/script-generator.module';
import { ExecutionModule } from './modules/execution/execution.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { TestCasesModule } from './modules/test-cases/test-cases.module';
import { TestDataModule } from './modules/test-data/test-data.module';
import { KnowledgeBaseModule } from './modules/knowledge-base/knowledge-base.module';
import { RagModule } from './modules/rag/rag.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { BugReportsModule } from './modules/bug-reports/bug-reports.module';
import { PipelineModule } from './modules/pipeline/pipeline.module';
import { AutomationPolicyModule } from './modules/automation-policy/automation-policy.module';
import { JiraCodexImportModule } from './modules/jira-codex-import/jira-codex-import.module';
import { WebRecorderModule } from './modules/web-recorder/web-recorder.module';
import { AiEngineeringModule } from './modules/ai-engineering/ai-engineering.module';
import { PrismaModule } from './prisma/prisma.module';
import { StartupReconciliationService } from './common/startup-reconciliation.service';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    AiProviderModule,
    ApplicationsModule,
    ScannerModule,
    ObjectLibraryModule,
    TestCasesModule,
    TestDataModule,
    AutomationBuilderModule,
    ScriptGeneratorModule,
    ExecutionModule,
    ReportingModule,
    RagModule,
    KnowledgeBaseModule,
    IntegrationsModule,
    BugReportsModule,
    PipelineModule,
    AutomationPolicyModule,
    JiraCodexImportModule,
    WebRecorderModule,
    AiEngineeringModule,
  ],
  controllers: [AppController],
  providers: [AppService, StartupReconciliationService],
})
export class AppModule {}
