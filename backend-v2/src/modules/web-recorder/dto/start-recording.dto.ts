import { IsEnum, IsOptional, IsUrl } from 'class-validator';
import { AutomationFramework } from '../../../../generated/prisma/enums';

export class StartRecordingDto {
  @IsUrl({ require_tld: false })
  targetUrl!: string;

  @IsEnum(AutomationFramework)
  @IsOptional()
  framework?: AutomationFramework;
}
