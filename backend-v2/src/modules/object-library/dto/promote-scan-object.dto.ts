import { IsOptional, IsString, MinLength } from 'class-validator';

export class PromoteScanObjectDto {
  @IsString()
  @MinLength(1)
  objectName!: string;

  @IsString()
  @IsOptional()
  moduleName?: string;

  @IsString()
  @IsOptional()
  featureName?: string;

  @IsString()
  @IsOptional()
  screenName?: string;

  @IsString()
  @IsOptional()
  displayLabel?: string;
}
