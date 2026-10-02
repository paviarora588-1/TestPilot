import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTestDataItemDto {
  @IsString()
  @MinLength(1)
  key!: string;

  @IsString()
  value!: string;

  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;
}

export class UpdateTestDataItemDto {
  @IsString()
  @IsOptional()
  key?: string;

  @IsString()
  @IsOptional()
  value?: string;

  @IsBoolean()
  @IsOptional()
  isSensitive?: boolean;
}
