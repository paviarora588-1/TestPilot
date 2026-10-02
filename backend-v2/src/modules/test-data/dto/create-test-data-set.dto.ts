import { IsBoolean, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateTestDataSetDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsString()
  @IsOptional()
  environment?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsBoolean()
  @IsOptional()
  isReusable?: boolean;
}
