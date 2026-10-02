import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptCredential, encryptCredential } from '../../common/crypto.util';
import type { AutomationFramework, RecordingStatus } from '../../../generated/prisma/enums';
import type { UpdateRecordingStepDto } from './dto/update-recording-step.dto';
import type { NormalizedStepInput } from './event-normalizer';

// A captured field is treated as sensitive if its own label/type-hint smells
// like a credential — a password-type input is caught here even before the
// user gets a chance to mark it themselves in review, so a plaintext
// password never sits in rawValue for longer than the single write below.
const SENSITIVE_HINT = /password|passwd|pwd|pin\b|otp|secret|token|card\s*number|cvv|ssn/i;

// Only genuine user-entered data can possibly be a credential — a NAVIGATE's
// "value" is just the destination URL and a CLICK/tab-switch has none at
// all. Restricting to these two action types caught a second live false
// positive beyond the value-less-step one: a NAVIGATE step was flagged
// sensitive purely because the destination page's own title happened to
// contain "Password" ("Reset Password - RP"), even though its rawValue was
// just that URL, nothing a user typed.
const SENSITIVE_ACTION_TYPES: NormalizedStepInput['actionType'][] = ['ENTER_TEXT', 'SELECT_OPTION'];

function looksSensitive(input: NormalizedStepInput): boolean {
  if (input.rawValue == null) return false;
  if (!SENSITIVE_ACTION_TYPES.includes(input.actionType)) return false;
  const haystack = `${input.label ?? ''} ${input.objectTypeHint ?? ''} ${input.recommendedLocator ?? ''}`;
  return SENSITIVE_HINT.test(haystack);
}

// Guarded status transitions, same shape as ScannerService's own
// updateMany-with-a-where-clause-on-status pattern — the DB row itself is
// the single source of truth for "is this session actually still active",
// so a stale/duplicate request (e.g. a double-click on Stop) can't corrupt
// state or double-fire whatever happens after a transition.
const ACTIVE_STATUSES: RecordingStatus[] = ['LAUNCHING', 'RECORDING', 'PAUSED'];

@Injectable()
export class WebRecordingSessionService {
  constructor(private readonly prisma: PrismaService) {}

  list(applicationId: string) {
    return this.prisma.webRecordingSession.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const session = await this.prisma.webRecordingSession.findUnique({
      where: { id },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!session) {
      throw new NotFoundException(`Recording session ${id} not found`);
    }
    // A sensitive step's real value never leaves the server once captured —
    // not the ciphertext, and not a decrypted plaintext either, even to the
    // user who recorded it. It plays through generated scripts as an env
    // var (see WebRecorderFlowBuilderService), never round-trips to the UI.
    return {
      ...session,
      steps: session.steps.map(({ encryptedValue: _encryptedValue, ...step }) => ({
        ...step,
        rawValue: step.isSensitive ? null : step.rawValue,
      })),
    };
  }

  async create(applicationId: string, targetUrl: string, framework: AutomationFramework, startedById?: string) {
    const application = await this.prisma.application.findUnique({ where: { id: applicationId } });
    if (!application) {
      throw new NotFoundException(`Application ${applicationId} not found`);
    }
    return this.prisma.webRecordingSession.create({
      data: { applicationId, targetUrl, framework, status: 'LAUNCHING', startedById },
    });
  }

  async markStatus(id: string, from: RecordingStatus[], to: RecordingStatus, patch: Record<string, unknown> = {}) {
    const result = await this.prisma.webRecordingSession.updateMany({
      where: { id, status: { in: from } },
      data: { status: to, ...patch },
    });
    if (result.count === 0) {
      const existing = await this.prisma.webRecordingSession.findUnique({ where: { id }, select: { status: true } });
      if (!existing) {
        throw new NotFoundException(`Recording session ${id} not found`);
      }
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Recording session is ${existing.status}, expected one of: ${from.join(', ')}.`],
        nextActions: ['Refresh the session and try again.'],
      });
    }
  }

  async touchActivity(id: string) {
    await this.prisma.webRecordingSession
      .update({ where: { id }, data: { lastActivityAt: new Date() } })
      .catch(() => undefined);
  }

  async appendStep(sessionId: string, input: NormalizedStepInput) {
    const last = await this.prisma.webRecordingStep.findFirst({
      where: { sessionId },
      orderBy: { stepOrder: 'desc' },
      select: { stepOrder: true },
    });
    const isSensitive = looksSensitive(input);

    return this.prisma.webRecordingStep.create({
      data: {
        sessionId,
        stepOrder: (last?.stepOrder ?? 0) + 1,
        actionType: input.actionType,
        label: input.label,
        pageUrl: input.pageUrl,
        pageTitle: input.pageTitle,
        frameUrl: input.frameUrl,
        tabIndex: input.tabIndex,
        recommendedLocator: input.recommendedLocator,
        recommendedLocatorType: input.recommendedLocatorType ?? undefined,
        backupLocators: (input.backupLocators as never) ?? undefined,
        objectTypeHint: input.objectTypeHint,
        config: (input.config as never) ?? undefined,
        isSensitive,
        rawValue: input.rawValue != null && !isSensitive ? input.rawValue : undefined,
        encryptedValue: input.rawValue != null && isSensitive ? encryptCredential(input.rawValue) : undefined,
      },
    });
  }

  async updateStep(sessionId: string, stepId: string, dto: UpdateRecordingStepDto) {
    const step = await this.prisma.webRecordingStep.findFirst({ where: { id: stepId, sessionId } });
    if (!step) {
      throw new NotFoundException(`Step ${stepId} not found on session ${sessionId}`);
    }

    const data: Record<string, unknown> = {};
    if (dto.label !== undefined) data.label = dto.label;
    if (dto.isVariable !== undefined) data.isVariable = dto.isVariable;
    if (dto.variableName !== undefined) data.variableName = dto.variableName;

    // Toggling sensitivity moves the value between rawValue and
    // encryptedValue rather than just flipping a flag on top of whichever
    // one currently holds it — the two fields are mutually exclusive, and
    // the flag alone would otherwise leave the invariant to accidental luck.
    if (dto.isSensitive !== undefined && dto.isSensitive !== step.isSensitive) {
      data.isSensitive = dto.isSensitive;
      if (dto.isSensitive) {
        if (step.rawValue) {
          data.encryptedValue = encryptCredential(step.rawValue);
          data.rawValue = null;
        }
      } else if (step.encryptedValue) {
        data.rawValue = decryptCredential(step.encryptedValue);
        data.encryptedValue = null;
      }
    }

    const { encryptedValue: _encryptedValue, ...updated } = await this.prisma.webRecordingStep.update({
      where: { id: stepId },
      data,
    });
    return { ...updated, rawValue: updated.isSensitive ? null : updated.rawValue };
  }

  async deleteStep(sessionId: string, stepId: string) {
    const result = await this.prisma.webRecordingStep.deleteMany({ where: { id: stepId, sessionId } });
    if (result.count === 0) {
      throw new NotFoundException(`Step ${stepId} not found on session ${sessionId}`);
    }
    return { success: true };
  }

  async reorderSteps(sessionId: string, orderedStepIds: string[]) {
    const steps = await this.prisma.webRecordingStep.findMany({ where: { sessionId }, select: { id: true } });
    const validIds = new Set(steps.map((s) => s.id));
    const isExactSet = orderedStepIds.length === validIds.size && orderedStepIds.every((id) => validIds.has(id));
    if (!isExactSet) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['orderedStepIds must list exactly the current steps of this session, each exactly once.'],
        nextActions: ['Refetch the step list and try again.'],
      });
    }
    await this.prisma.$transaction(
      orderedStepIds.map((id, index) =>
        this.prisma.webRecordingStep.update({ where: { id }, data: { stepOrder: index + 1 } }),
      ),
    );
    return { success: true };
  }

  async remove(id: string) {
    const session = await this.prisma.webRecordingSession.findUnique({ where: { id }, select: { status: true } });
    if (!session) {
      throw new NotFoundException(`Recording session ${id} not found`);
    }
    if ((ACTIVE_STATUSES as string[]).includes(session.status)) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This recording is still active.'],
        nextActions: ['Stop or cancel it before deleting.'],
      });
    }
    await this.prisma.webRecordingSession.delete({ where: { id } });
    return { success: true };
  }
}
