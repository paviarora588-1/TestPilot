import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ScanCurrentPageDto {
  // Chrome/Edge only exposes their DevTools Protocol when launched with
  // --remote-debugging-port=<port> — there's no way to attach to a normal,
  // already-running browser window otherwise. Optional so the common default
  // (9222) doesn't need to be typed every time.
  @IsString()
  @IsOptional()
  cdpUrl?: string;

  // Which open tab to capture, by its position from GET .../current-page-scans/tabs.
  // Omitted falls back to guessing the focused tab (fine when only one tab is open).
  @IsInt()
  @Min(0)
  @IsOptional()
  pageIndex?: number;
}
