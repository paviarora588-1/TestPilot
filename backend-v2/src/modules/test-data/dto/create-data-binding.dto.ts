import { IsOptional, IsString } from 'class-validator';

export class CreateDataBindingDto {
  @IsString()
  @IsOptional()
  testStepId?: string;

  @IsString()
  @IsOptional()
  testCaseId?: string;

  @IsString()
  @IsOptional()
  testDataItemId?: string;

  @IsString()
  @IsOptional()
  bindingExpression?: string;
}
