import { IsString, MaxLength, MinLength } from 'class-validator';

export class AddUnsafeClickWordDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  word!: string;
}
