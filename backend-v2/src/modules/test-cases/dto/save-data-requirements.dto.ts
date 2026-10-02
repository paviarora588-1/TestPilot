import { Type } from 'class-transformer';
import { IsArray, IsString, MinLength, ValidateNested } from 'class-validator';

export class DataRequirementValueDto {
  @IsString()
  @MinLength(1)
  objectId!: string;

  @IsString()
  value!: string;
}

export class SaveDataRequirementsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DataRequirementValueDto)
  values!: DataRequirementValueDto[];
}
