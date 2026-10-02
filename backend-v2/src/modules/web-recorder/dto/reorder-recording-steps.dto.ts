import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class ReorderRecordingStepsDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  orderedStepIds!: string[];
}
