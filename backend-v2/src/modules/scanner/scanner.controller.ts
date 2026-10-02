import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator';
import { APPROVAL_ROLES, OPERATIONAL_ROLES } from '../../common/role-groups';
import { AddUnsafeClickWordDto } from './dto/add-unsafe-click-word.dto';
import { LaunchCaptureBrowserDto } from './dto/launch-capture-browser.dto';
import { ScanCurrentPageDto } from './dto/scan-current-page.dto';
import { StartScanDto } from './dto/start-scan.dto';
import { StartSapGuiScanDto } from './dto/start-sap-gui-scan.dto';
import { ScannerService } from './scanner.service';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class ScannerController {
  constructor(private readonly scannerService: ScannerService) {}

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/scans')
  startScan(
    @Param('applicationId') applicationId: string,
    @Body() dto: StartScanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const credentials =
      dto.loginUsername && dto.loginPassword
        ? { username: dto.loginUsername, password: dto.loginPassword }
        : undefined;
    return this.scannerService.startScan(applicationId, dto.targetUrl, user.id, credentials);
  }

  // Read-only listing of every open SAP GUI connection/session, so the
  // frontend can offer a picker — the SAP GUI equivalent of listOpenTabs()
  // for the web capture-browser flow below.
  @Roles(...OPERATIONAL_ROLES)
  @Get('sap-sessions')
  listSapGuiSessions() {
    return this.scannerService.listSapGuiSessions();
  }

  // Attaches to a SAP GUI session on this machine — the first open one by
  // default, or a specific connection/session (from listSapGuiSessions
  // above) when more than one is open. No URL — there's nothing to
  // navigate to, it's a live desktop session.
  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/sap-scans')
  startSapGuiScan(
    @Param('applicationId') applicationId: string,
    @Body() dto: StartSapGuiScanDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scannerService.startSapGuiScan(applicationId, user.id, dto.connectionIndex ?? 0, dto.sessionIndex ?? 0);
  }

  // Spawns a dedicated capture browser (separate profile, remote debugging
  // on) on this machine so there's something for listOpenTabs/
  // startCurrentPageScan to attach to — the button that replaces manually
  // running "chrome.exe --remote-debugging-port=...".
  @Roles(...OPERATIONAL_ROLES)
  @Post('current-page-scans/launch-browser')
  launchCaptureBrowser(@Body() dto: LaunchCaptureBrowserDto) {
    return this.scannerService.launchCaptureBrowser(dto.port);
  }

  // Read-only peek at what's open in the connected browser, so the caller
  // can show a picker rather than guess which tab to capture.
  @Get('current-page-scans/tabs')
  listOpenTabs(@Query('cdpUrl') cdpUrl?: string) {
    return this.scannerService.listOpenTabs(cdpUrl);
  }

  // Attaches to a page already open in the user's own browser (no URL —
  // captures a real, possibly hard-to-reach app state, e.g. deep in a
  // login-gated multi-step flow, exactly as-is). Defaults to guessing the
  // focused tab when pageIndex is omitted.
  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/current-page-scans')
  startCurrentPageScan(
    @Param('applicationId') applicationId: string,
    @Body() dto: ScanCurrentPageDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scannerService.startCurrentPageScan(applicationId, dto.cdpUrl, dto.pageIndex, user.id);
  }

  @Get('applications/:applicationId/scans')
  listSessions(@Param('applicationId') applicationId: string) {
    return this.scannerService.listSessions(applicationId);
  }

  @Get('scans/:id')
  getSession(@Param('id') id: string) {
    return this.scannerService.getSession(id);
  }

  @Roles(...APPROVAL_ROLES)
  @Delete('scans/:id')
  removeSession(@Param('id') id: string) {
    return this.scannerService.removeSession(id);
  }

  // The per-application custom words layered onto the drill-down crawl's
  // own built-in safety denylist (see extractDrillTargets in dom-walker.ts)
  // — lets a human extend it for an app whose dangerous-action vocabulary
  // the built-in guess couldn't have known about in advance.
  @Get('applications/:applicationId/scan-unsafe-words')
  listUnsafeClickWords(@Param('applicationId') applicationId: string) {
    return this.scannerService.listUnsafeClickWords(applicationId);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Post('applications/:applicationId/scan-unsafe-words')
  addUnsafeClickWord(
    @Param('applicationId') applicationId: string,
    @Body() dto: AddUnsafeClickWordDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.scannerService.addUnsafeClickWord(applicationId, dto.word, user.id);
  }

  @Roles(...OPERATIONAL_ROLES)
  @Delete('scan-unsafe-words/:id')
  removeUnsafeClickWord(@Param('id') id: string) {
    return this.scannerService.removeUnsafeClickWord(id);
  }
}
