import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class LaunchCaptureBrowserDto {
  // Matches the default baked into listOpenTabs/startCurrentPageScan — optional
  // so the common case (one dedicated capture browser) needs no input at all.
  @IsInt()
  @Min(1024)
  @Max(65535)
  @IsOptional()
  port?: number;
}
