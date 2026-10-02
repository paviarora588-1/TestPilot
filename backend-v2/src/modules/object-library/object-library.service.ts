import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateObjectDto } from './dto/create-object.dto';
import { PromoteScanObjectDto } from './dto/promote-scan-object.dto';
import { UpdateObjectDto } from './dto/update-object.dto';
import type { LocatorType } from '../../../generated/prisma/enums';

// Some apps reuse the same element id/name on every screen (e.g. a generic
// "iconImage" logo button on every page) — objectName and technicalPath end
// up identical across screens, which makes the Automation Builder's object
// picker unusable (three indistinguishable "iconImage" entries). displayLabel
// disambiguates: prefer the element's own real accessible text if the scan
// captured any, otherwise synthesize "<screen> <type>" from context.
function computeDisplayLabel(
  scanObject: { buttonText: string | null; ariaLabel: string | null; nearbyLabelText: string | null; placeholder: string | null; objectType: string },
  screenName?: string | null,
): string | undefined {
  const realText = scanObject.buttonText || scanObject.ariaLabel || scanObject.nearbyLabelText || scanObject.placeholder;
  if (realText?.trim()) return realText.trim();
  if (screenName?.trim()) return `${screenName.trim()} ${scanObject.objectType}`.trim();
  return undefined;
}

// Mirrors the frontend's scanner-page deriveDefaults(): the scanner titles a
// page "{App} — {Tab label}" for anything beyond the base screen, so split on
// that same delimiter to get a meaningful Module/Feature/Screen default for
// every object on the page instead of leaving them blank.
function deriveScreenDefaults(pageTitle: string | null | undefined, appName: string) {
  const title = (pageTitle ?? '').trim();
  if (title.includes(' — ')) {
    const [app, screen] = title.split(' — ');
    return { moduleName: app.trim() || appName, featureName: screen.trim(), screenName: screen.trim() };
  }
  const fallback = title || appName;
  return { moduleName: appName, featureName: fallback, screenName: fallback };
}

@Injectable()
export class ObjectLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  list(applicationId: string) {
    return this.prisma.objectRepository.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(applicationId: string, dto: CreateObjectDto) {
    return this.prisma.objectRepository.create({
      data: { applicationId, ...dto },
    });
  }

  async get(id: string) {
    const object = await this.prisma.objectRepository.findUnique({ where: { id } });
    if (!object) {
      throw new NotFoundException(`Object ${id} not found`);
    }
    return object;
  }

  async update(id: string, dto: UpdateObjectDto) {
    await this.get(id);
    return this.prisma.objectRepository.update({ where: { id }, data: dto });
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.objectRepository.delete({ where: { id } });
    return { success: true };
  }

  async promoteFromScanObject(scanObjectId: string, dto: PromoteScanObjectDto) {
    const scanObject = await this.prisma.scanObject.findUnique({
      where: { id: scanObjectId },
      include: { scanPage: { include: { scanSession: true } } },
    });
    if (!scanObject) {
      throw new NotFoundException(`Scan object ${scanObjectId} not found`);
    }
    // ObjectRepository.sourceScanObjectId is DB-unique — without this check
    // a second promote of the same scan object hits that constraint raw and
    // surfaces as an unhandled 500 instead of a clear "already promoted".
    if (scanObject.promoted) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This object has already been promoted to the Object Library.'],
        nextActions: ['Find it in the Object Library instead of promoting it again.'],
      });
    }

    const applicationId = scanObject.scanPage.scanSession.applicationId;

    const created = await this.prisma.objectRepository.create({
      data: {
        applicationId,
        moduleName: dto.moduleName,
        featureName: dto.featureName,
        screenName: dto.screenName,
        objectName: dto.objectName,
        displayLabel: dto.displayLabel?.trim() || computeDisplayLabel(scanObject, dto.screenName),
        objectType: scanObject.objectType,
        technicalPath: scanObject.recommendedLocator,
        locatorStrategy: scanObject.recommendedLocatorType,
        backupLocators: scanObject.backupLocators ?? undefined,
        confidenceScore: scanObject.confidenceScore,
        verificationStatus: scanObject.lastWorkingStatus,
        screenshotPath: scanObject.scanPage.screenshotPath,
        sourceScanObjectId: scanObject.id,
      },
    });

    await this.prisma.scanObject.update({
      where: { id: scanObjectId },
      data: { promoted: true },
    });

    return created;
  }

  async promoteAllFromScanPage(scanPageId: string) {
    const scanPage = await this.prisma.scanPage.findUnique({
      where: { id: scanPageId },
      include: {
        scanSession: { include: { application: true } },
        objects: { where: { promoted: false } },
      },
    });
    if (!scanPage) {
      throw new NotFoundException(`Scan page ${scanPageId} not found`);
    }

    const applicationId = scanPage.scanSession.applicationId;
    const defaults = deriveScreenDefaults(scanPage.title, scanPage.scanSession.application.name);

    const created: Awaited<ReturnType<typeof this.prisma.objectRepository.create>>[] = [];
    for (const scanObject of scanPage.objects) {
      const entry = await this.prisma.objectRepository.create({
        data: {
          applicationId,
          moduleName: defaults.moduleName,
          featureName: defaults.featureName,
          screenName: defaults.screenName,
          objectName: scanObject.label?.trim() || scanObject.objectType,
          displayLabel: computeDisplayLabel(scanObject, defaults.screenName),
          objectType: scanObject.objectType,
          technicalPath: scanObject.recommendedLocator,
          locatorStrategy: scanObject.recommendedLocatorType,
          backupLocators: scanObject.backupLocators ?? undefined,
          confidenceScore: scanObject.confidenceScore,
          verificationStatus: scanObject.lastWorkingStatus,
          screenshotPath: scanPage.screenshotPath,
          sourceScanObjectId: scanObject.id,
        },
      });
      await this.prisma.scanObject.update({ where: { id: scanObject.id }, data: { promoted: true } });
      created.push(entry);
    }

    return { promoted: created.length, objects: created };
  }

  // "Promote All" for the Scanner page's synthetic "Common (shared across
  // pages)" tab — that tab isn't a real ScanPage row (objects on it were
  // pulled out of several different real pages), so promoteAllFromScanPage's
  // scanPageId lookup doesn't apply. Resolves each object's own originating
  // page individually instead of assuming one shared page/defaults. Skips
  // (rather than fails) an id that's missing or already promoted, so one
  // stale id in the batch doesn't block every other one.
  async promoteMany(scanObjectIds: string[]) {
    const created: Awaited<ReturnType<typeof this.prisma.objectRepository.create>>[] = [];
    for (const scanObjectId of scanObjectIds) {
      const scanObject = await this.prisma.scanObject.findUnique({
        where: { id: scanObjectId },
        include: { scanPage: { include: { scanSession: { include: { application: true } } } } },
      });
      if (!scanObject || scanObject.promoted) continue;

      const applicationId = scanObject.scanPage.scanSession.applicationId;
      const defaults = deriveScreenDefaults(scanObject.scanPage.title, scanObject.scanPage.scanSession.application.name);

      const entry = await this.prisma.objectRepository.create({
        data: {
          applicationId,
          moduleName: defaults.moduleName,
          featureName: defaults.featureName,
          screenName: defaults.screenName,
          objectName: scanObject.label?.trim() || scanObject.objectType,
          displayLabel: computeDisplayLabel(scanObject, defaults.screenName),
          objectType: scanObject.objectType,
          technicalPath: scanObject.recommendedLocator,
          locatorStrategy: scanObject.recommendedLocatorType,
          backupLocators: scanObject.backupLocators ?? undefined,
          confidenceScore: scanObject.confidenceScore,
          verificationStatus: scanObject.lastWorkingStatus,
          screenshotPath: scanObject.scanPage.screenshotPath,
          sourceScanObjectId: scanObject.id,
        },
      });
      await this.prisma.scanObject.update({ where: { id: scanObjectId }, data: { promoted: true } });
      created.push(entry);
    }

    return { promoted: created.length, objects: created };
  }

  // Used by the Web Action Recorder when converting a recording into an
  // AutomationFlow: exact-match only (applicationId + technicalPath), no
  // fuzzy/AI matching — deliberately narrow, matching the existing
  // accepted gap elsewhere in the Object Library (promoteFromScanObject and
  // friends have never deduped against existing rows either, only against
  // re-promoting the same ScanObject twice). Two elements that render
  // identically but resolve to even slightly different locator strings
  // still produce two rows; solving that is a bigger, separate change.
  async findOrCreateObjectForLocator(
    applicationId: string,
    input: {
      objectName: string;
      screenName?: string | null;
      objectType: string;
      technicalPath: string;
      locatorStrategy: LocatorType;
      backupLocators?: string[] | null;
      confidenceScore?: number | null;
      displayLabel?: string | null;
    },
  ) {
    const existing = await this.prisma.objectRepository.findFirst({
      where: { applicationId, technicalPath: input.technicalPath },
    });
    if (existing) return existing;

    return this.prisma.objectRepository.create({
      data: {
        applicationId,
        objectName: input.objectName,
        screenName: input.screenName ?? undefined,
        displayLabel: input.displayLabel ?? undefined,
        objectType: input.objectType,
        technicalPath: input.technicalPath,
        locatorStrategy: input.locatorStrategy,
        backupLocators: (input.backupLocators as never) ?? undefined,
        confidenceScore: input.confidenceScore ?? undefined,
      },
    });
  }
}
