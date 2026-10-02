import { IsObject } from 'class-validator';

export class UpdateFlowGraphDto {
  @IsObject()
  graphJson!: Record<string, unknown>;
}
