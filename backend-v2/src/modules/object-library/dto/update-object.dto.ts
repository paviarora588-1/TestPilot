import { IsArray, IsEnum, IsOptional, IsString } from 'class-validator';
import { LocatorType, WorkingStatus } from '../../../../generated/prisma/enums';

export class UpdateObjectDto {
  @IsString()
  @IsOptional()
  objectName?: string;

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
  @IsOptional()
  objectType?: string;

  @IsString()
  @IsOptional()
  technicalPath?: string;

  // Was missing entirely — ValidationPipe's whitelist mode silently strips
  // any field not declared here, so PUT-ing a corrected backupLocators list
  // (e.g. while manually approving/adjusting a self-heal candidate) had no
  // effect and no error, just silent data loss.
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  backupLocators?: string[];

  @IsEnum(LocatorType)
  @IsOptional()
  locatorStrategy?: LocatorType;

  @IsEnum(WorkingStatus)
  @IsOptional()
  verificationStatus?: WorkingStatus;

  @IsString()
  @IsOptional()
  scope?: string;
}
