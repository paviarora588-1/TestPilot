import { Module } from '@nestjs/common';
import { ObjectLibraryController } from './object-library.controller';
import { ObjectLibraryService } from './object-library.service';

@Module({
  controllers: [ObjectLibraryController],
  providers: [ObjectLibraryService],
  exports: [ObjectLibraryService],
})
export class ObjectLibraryModule {}
