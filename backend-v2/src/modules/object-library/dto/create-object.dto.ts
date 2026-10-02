import { IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { LocatorType } from '../../../../generated/prisma/enums';

export class CreateObjectDto {
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

  @IsString()
  @MinLength(1)
  objectType!: string;

  @IsString()
  @MinLength(1)
  technicalPath!: string;

  @IsEnum(LocatorType)
  locatorStrategy!: LocatorType;
}
