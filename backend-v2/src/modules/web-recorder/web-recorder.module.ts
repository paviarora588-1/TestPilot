import { Module } from '@nestjs/common';
import { ObjectLibraryModule } from '../object-library/object-library.module';
import { AutomationBuilderModule } from '../automation-builder/automation-builder.module';
import { WebRecorderController } from './web-recorder.controller';
import { WebRecordingSessionService } from './web-recording-session.service';
import { WebRecorderRuntimeService } from './web-recorder-runtime.service';
import { WebRecorderFlowBuilderService } from './flow-builder';

@Module({
  imports: [ObjectLibraryModule, AutomationBuilderModule],
  controllers: [WebRecorderController],
  providers: [WebRecordingSessionService, WebRecorderRuntimeService, WebRecorderFlowBuilderService],
  exports: [WebRecordingSessionService, WebRecorderRuntimeService],
})
export class WebRecorderModule {}
