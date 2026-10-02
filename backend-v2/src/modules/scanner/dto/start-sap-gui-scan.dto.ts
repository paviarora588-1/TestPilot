import { IsInt, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class StartSapGuiScanDto {
  // Both default to 0 (the first open connection/session) when omitted —
  // matching the pre-existing always-grab-the-first behavior for callers
  // that don't care which session, e.g. the common single-session case.
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  connectionIndex?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  sessionIndex?: number;
}
