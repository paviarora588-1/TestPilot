import { Module } from '@nestjs/common';
import { AiProviderModule } from '../ai-provider/ai-provider.module';
import { AiEngineeringController } from './ai-engineering.controller';
import { AiEngineeringService } from './ai-engineering.service';

@Module({
  imports: [AiProviderModule],
  controllers: [AiEngineeringController],
  providers: [AiEngineeringService],
  exports: [AiEngineeringService],
})
export class AiEngineeringModule {}
