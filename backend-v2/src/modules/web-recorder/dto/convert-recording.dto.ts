import { IsOptional, IsString } from 'class-validator';

export class ConvertRecordingDto {
  @IsString()
  @IsOptional()
  flowName?: string;
}
