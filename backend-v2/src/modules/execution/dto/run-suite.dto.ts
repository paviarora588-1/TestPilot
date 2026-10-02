import { IsArray, IsEnum, IsString } from 'class-validator';
import { SuiteScope } from '../../../../generated/prisma/enums';

export class RunSuiteDto {
  @IsEnum(SuiteScope)
  scope!: SuiteScope;

  @IsArray()
  @IsString({ each: true })
  scriptIds!: string[];
}
