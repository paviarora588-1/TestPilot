import { Module } from '@nestjs/common';
import { AiEngineeringModule } from '../ai-engineering/ai-engineering.module';
import { ScanGateway } from './scan.gateway';
import { ScannerController } from './scanner.controller';
import { ScannerService } from './scanner.service';

@Module({
  imports: [AiEngineeringModule],
  controllers: [ScannerController],
  providers: [ScannerService, ScanGateway],
  exports: [ScannerService],
})
export class ScannerModule {}
