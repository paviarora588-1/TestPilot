import { ArrayMinSize, IsArray, IsString } from 'class-validator';

export class PromoteManyDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  scanObjectIds!: string[];
}
