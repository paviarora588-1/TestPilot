import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { decryptCredential } from '../../common/crypto.util';
import { ObjectLibraryService } from '../../modules/object-library/object-library.service';
import { AutomationBuilderService } from '../../modules/automation-builder/automation-builder.service';
import { WebRecordingSessionService } from './web-recording-session.service';
import type { FlowStepType, RecordedActionType } from '../../../generated/prisma/enums';
import type { ConvertRecordingDto } from './dto/convert-recording.dto';

// A recorded action maps onto the SAME step vocabulary the manual and
// AI-generated flow paths already use — the compiler downstream doesn't (and
// shouldn't) know or care which of the three produced a given
// AutomationFlowStep. CHECK/UNCHECK have no dedicated FlowStepType of their
// own (a checkbox is just a CLICK to the compiler); DOUBLE_CLICK/RIGHT_CLICK
// carry their distinction in config instead, since adding new enum members
// for them is a bigger compiler change than this phase's scope. CLOSE_TAB
// has no dedicated step type either — it's recorded as a labeled SWITCH_TAB.
const ACTION_TO_STEP_TYPE: Record<RecordedActionType, FlowStepType> = {
  NAVIGATE: 'OPEN_URL',
  CLICK: 'CLICK',
  DOUBLE_CLICK: 'CLICK',
  RIGHT_CLICK: 'CLICK',
  ENTER_TEXT: 'ENTER_TEXT',
  SELECT_OPTION: 'SELECT_DROPDOWN',
  CHECK: 'CLICK',
  UNCHECK: 'CLICK',
  UPLOAD_FILE: 'UPLOAD_FILE',
  NEW_TAB: 'SWITCH_TAB',
  SWITCH_TAB: 'SWITCH_TAB',
  CLOSE_TAB: 'SWITCH_TAB',
  ALERT_ACCEPT: 'ACCEPT_ALERT',
  ALERT_DISMISS: 'ACCEPT_ALERT',
};

// Mirrors the frontend's own deriveVariableName (web-recorder/page.tsx) —
// same fallback reasoning, needed here too since a sensitive step now always
// gets a variable name, not just one the user explicitly typed in review.
function deriveDefaultVariableName(step: { label: string | null; actionType: RecordedActionType }): string {
  const source = step.label?.trim().toLowerCase() || step.actionType.toLowerCase();
  return source.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'value';
}

interface GraphNode {
  id: string;
  type: 'step';
  position: { x: number; y: number };
  data: {
    stepType: FlowStepType;
    objectId: string | null;
    testDataItemId: string | null;
    inlineValue: string | null;
    config: Record<string, unknown> | null;
  };
}

@Injectable()
export class WebRecorderFlowBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: WebRecordingSessionService,
    private readonly objectLibrary: ObjectLibraryService,
    private readonly automationBuilder: AutomationBuilderService,
  ) {}

  async convert(sessionId: string, dto: ConvertRecordingDto) {
    const session = await this.prisma.webRecordingSession.findUnique({
      where: { id: sessionId },
      include: { steps: { orderBy: { stepOrder: 'asc' } } },
    });
    if (!session) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Recording session ${sessionId} not found.`],
        nextActions: [],
      });
    }
    if (session.status !== 'STOPPED') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Recording is ${session.status}; it must be STOPPED before it can be converted.`],
        nextActions: ['Stop the recording, review the steps, then convert.'],
      });
    }

    const flow = session.automationFlowId
      ? await this.automationBuilder.get(session.automationFlowId)
      : await this.automationBuilder.create(session.applicationId, {
          name: dto.flowName?.trim() || `Recorded flow — ${new URL(session.targetUrl).hostname}`,
          framework: session.framework,
        });

    let autoDataSetId: string | null = null;
    const getOrCreateDataSetId = async () => {
      if (autoDataSetId) return autoDataSetId;
      const existing = await this.prisma.testDataSet.findFirst({
        where: { applicationId: session.applicationId, name: 'Recorded' },
      });
      const set =
        existing ??
        (await this.prisma.testDataSet.create({
          data: {
            applicationId: session.applicationId,
            name: 'Recorded',
            description: 'Values captured while recording a Web Action Recorder session — reviewed and edited here as needed.',
          },
        }));
      autoDataSetId = set.id;
      return set.id;
    };

    const nodes: GraphNode[] = [];
    let index = 0;
    for (const step of session.steps) {
      const stepType = ACTION_TO_STEP_TYPE[step.actionType];
      let objectId: string | null = null;
      let testDataItemId: string | null = null;
      let inlineValue: string | null = null;

      if (step.recommendedLocator) {
        const created = await this.objectLibrary.findOrCreateObjectForLocator(session.applicationId, {
          objectName: step.label?.trim() || step.objectTypeHint || step.actionType,
          screenName: step.pageTitle ?? undefined,
          objectType: step.objectTypeHint || 'element',
          technicalPath: step.recommendedLocator,
          locatorStrategy: step.recommendedLocatorType ?? 'CSS',
          backupLocators: (step.backupLocators as string[] | null) ?? undefined,
          confidenceScore: undefined,
          displayLabel: step.label ?? undefined,
        });
        objectId = created.id;
      }

      if (step.actionType === 'NAVIGATE') {
        inlineValue = step.rawValue;
      } else if (step.isVariable || step.isSensitive) {
        // A sensitive value ALWAYS gets bound to a real TestDataItem, even if
        // the user never explicitly clicked "mark as variable" — leaving it
        // unbound instead (an earlier version of this code did) compiles to
        // an ENTER_TEXT step with no value at all, which silently produces a
        // script that types nothing into a password field and then submits
        // it. That's a broken script, not a safe default; confirmed against
        // a real recorded SAP Fiori login (the password step generated
        // `enterPassword("")`, so the "sign in" click that followed it could
        // never actually succeed). Auto-naming when the user didn't supply
        // one keeps this from ever landing on a value-less step again.
        const variableName = step.variableName || deriveDefaultVariableName(step);
        const value = step.isSensitive
          ? step.encryptedValue
            ? decryptCredential(step.encryptedValue)
            : ''
          : (step.rawValue ?? '');
        const setId = await getOrCreateDataSetId();
        const existingItem = await this.prisma.testDataItem.findFirst({
          where: { testDataSetId: setId, key: variableName },
        });
        const item =
          existingItem ??
          (await this.prisma.testDataItem.create({
            data: { testDataSetId: setId, key: variableName, value, isSensitive: step.isSensitive },
          }));
        testDataItemId = item.id;
      } else {
        inlineValue = step.rawValue;
      }

      nodes.push({
        id: `rec-node-${index + 1}`,
        type: 'step',
        position: { x: 250, y: index * 120 },
        data: {
          stepType,
          objectId,
          testDataItemId,
          inlineValue,
          config:
            step.actionType === 'DOUBLE_CLICK' || step.actionType === 'RIGHT_CLICK' || step.actionType === 'CLOSE_TAB'
              ? { recordedActionType: step.actionType }
              : null,
        },
      });
      index++;
    }

    if (nodes.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This recording has no steps to convert.'],
        nextActions: ['Record at least one action before converting.'],
      });
    }

    const edges = nodes.slice(0, -1).map((node, i) => ({
      id: `${node.id}->${nodes[i + 1].id}`,
      source: node.id,
      target: nodes[i + 1].id,
    }));
    const graphJson = { nodes, edges, viewport: { x: 0, y: 0, zoom: 1 } };

    await this.automationBuilder.updateGraph(flow.id, graphJson);
    await this.sessions.markStatus(sessionId, ['STOPPED'], 'CONVERTED', { automationFlowId: flow.id });

    return this.automationBuilder.get(flow.id);
  }
}
