import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { RagService } from './rag.service';

@Module({
  imports: [AiProviderModule],
  providers: [RagService],
  exports: [RagService],
})
export class RagModule {}
