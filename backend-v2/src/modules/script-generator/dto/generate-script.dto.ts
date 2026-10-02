import { IsEnum, IsOptional } from 'class-validator';

export enum SapScriptLanguage {
  VBSCRIPT = 'VBSCRIPT',
  POWERSHELL = 'POWERSHELL',
}

// Only meaningful for flow segments that compile to SAP GUI — ignored for
// pure-web flows. Defaults to VBScript (see ScriptGeneratorService) since
// that's the literal target most SAP customer environments expect; the
// existing PowerShell compiler remains available via this flag rather than
// being replaced.
export class GenerateScriptDto {
  @IsEnum(SapScriptLanguage)
  @IsOptional()
  sapScriptLanguage?: SapScriptLanguage;
}
