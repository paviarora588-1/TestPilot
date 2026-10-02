import { IsString, MinLength } from 'class-validator';

export class GenerateFromTestCaseDto {
  @IsString()
  @MinLength(1)
  testCaseId!: string;
}
