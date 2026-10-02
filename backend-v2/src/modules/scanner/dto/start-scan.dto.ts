import { IsOptional, IsString, IsUrl } from 'class-validator';

export class StartScanDto {
  @IsUrl({ require_tld: false })
  targetUrl!: string;

  // Per-scan only — never persisted (no ScanSession column for these), held
  // in memory for the duration of this one crawl to attempt a login before
  // the real scan begins. See ScannerService.attemptAutoLogin.
  @IsString()
  @IsOptional()
  loginUsername?: string;

  @IsString()
  @IsOptional()
  loginPassword?: string;
}
