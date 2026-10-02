import { Module } from '@nestjs/common';
import { AutomationBuilderModule } from '../automation-builder/automation-builder.module';
import { ScriptGeneratorModule } from '../script-generator/script-generator.module';
import { ExecutionModule } from '../execution/execution.module';
import { PipelineController } from './pipeline.controller';
import { PipelineService } from './pipeline.service';

@Module({
  imports: [AutomationBuilderModule, ScriptGeneratorModule, ExecutionModule],
  controllers: [PipelineController],
  providers: [PipelineService],
  exports: [PipelineService],
})
export class PipelineModule {}
