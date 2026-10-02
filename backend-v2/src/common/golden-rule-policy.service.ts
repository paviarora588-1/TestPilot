import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FlowStepType } from '../../generated/prisma/enums';

export interface BlockersResult {
  blocked: boolean;
  reasons: string[];
  nextActions: string[];
}

const DEFAULT_POLICY = {
  minimumMappingConfidence: 0.7,
  maximumAllowedRiskScore: 0.5,
  requireAiReviewPass: true,
  requireKnowledgeProcessed: true,
  requireObjectVerification: true,
  qualityWatchEnabled: false,
  qualityWatchMaxObjectsPerRun: 25,
};

const OBJECT_REQUIRED_STEPS: FlowStepType[] = [
  'CLICK',
  'ENTER_TEXT',
  'SELECT_DROPDOWN',
  'VERIFY_TEXT',
  'VERIFY_ELEMENT_VISIBLE',
  'UPLOAD_FILE',
  'HOVER',
  'SCROLL',
];

/**
 * Ports the legacy app's "Golden Automation Rule" gating (generation_blockers /
 * script_execution_blockers in endpoints.py) into first-class, reusable policy
 * data instead of ad-hoc inline checks.
 *
 * Deliberately NOT enforced yet: requireKnowledgeProcessed (Knowledge Base
 * doesn't exist until Phase 5) and requireObjectVerification's WORKING-status
 * check (nothing can ever reach WORKING without an execution loop, which is
 * Phase 4) — hard-blocking on either right now would make script generation
 * permanently impossible. Both re-engage automatically once their prerequisite
 * phases land, since this service reads the policy row, not a hardcoded list.
 */
@Injectable()
export class GoldenRulePolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async getPolicyForApplication(applicationId: string) {
    const override = await this.prisma.automationPolicySetting.findUnique({ where: { applicationId } });
    if (override) return override;
    const global = await this.prisma.automationPolicySetting.findFirst({ where: { applicationId: null } });
    return global ?? { id: null, applicationId: null, ...DEFAULT_POLICY };
  }

  // Lets an admin actually configure what was previously only a schema field
  // with no UI or endpoint anywhere — the execution-blocking thresholds are
  // real, intentional policy knobs, not something that should only be
  // reachable via direct database access.
  async upsertPolicyForApplication(
    applicationId: string,
    patch: Partial<{
      minimumMappingConfidence: number;
      maximumAllowedRiskScore: number;
      requireAiReviewPass: boolean;
      requireKnowledgeProcessed: boolean;
      requireObjectVerification: boolean;
      qualityWatchEnabled: boolean;
      qualityWatchMaxObjectsPerRun: number;
    }>,
  ) {
    const current = await this.getPolicyForApplication(applicationId);
    return this.prisma.automationPolicySetting.upsert({
      where: { applicationId },
      create: {
        applicationId,
        minimumMappingConfidence: patch.minimumMappingConfidence ?? current.minimumMappingConfidence,
        maximumAllowedRiskScore: patch.maximumAllowedRiskScore ?? current.maximumAllowedRiskScore,
        requireAiReviewPass: patch.requireAiReviewPass ?? current.requireAiReviewPass,
        requireKnowledgeProcessed: patch.requireKnowledgeProcessed ?? current.requireKnowledgeProcessed,
        requireObjectVerification: patch.requireObjectVerification ?? current.requireObjectVerification,
        qualityWatchEnabled: patch.qualityWatchEnabled ?? current.qualityWatchEnabled,
        qualityWatchMaxObjectsPerRun: patch.qualityWatchMaxObjectsPerRun ?? current.qualityWatchMaxObjectsPerRun,
      },
      update: patch,
    });
  }

  async checkFlowGenerationBlockers(flowId: string): Promise<BlockersResult> {
    const flow = await this.prisma.automationFlow.findUnique({
      where: { id: flowId },
      include: { steps: { orderBy: { stepOrder: 'asc' }, include: { object: true } } },
    });

    if (!flow) {
      return { blocked: true, reasons: ['Flow not found'], nextActions: [] };
    }

    const policy = await this.getPolicyForApplication(flow.applicationId);
    const reasons: string[] = [];
    const nextActions: string[] = [];

    if (flow.steps.length === 0) {
      reasons.push('The flow has no steps yet.');
      nextActions.push('Add at least one step in the Automation Builder.');
    }

    for (const step of flow.steps) {
      if (OBJECT_REQUIRED_STEPS.includes(step.stepType) && !step.objectId) {
        reasons.push(`Step ${step.stepOrder} (${step.stepType}) has no object assigned.`);
        nextActions.push(`Assign an Object Library entry to step ${step.stepOrder}.`);
        continue;
      }
      // A manually verified object is a human vouching for the locator —
      // that supersedes the scanner's own confidence score, same as a real
      // QA engineer signing off on a flaky auto-detected selector.
      if (
        step.object?.verificationStatus !== 'WORKING' &&
        step.object?.confidenceScore != null &&
        step.object.confidenceScore < policy.minimumMappingConfidence
      ) {
        const gotPct = Math.round(step.object.confidenceScore * 100);
        const needPct = Math.round(policy.minimumMappingConfidence * 100);
        reasons.push(
          `Step ${step.stepOrder} uses "${step.object.objectName}" whose confidence (${gotPct}%) is below the required ${needPct}%.`,
        );
        nextActions.push(`Re-scan or manually verify "${step.object.objectName}" in the Object Library.`);
      }
    }

    return { blocked: reasons.length > 0, reasons, nextActions };
  }

  async checkScriptExecutionBlockers(scriptId: string): Promise<BlockersResult> {
    const script = await this.prisma.generatedScript.findUnique({
      where: { id: scriptId },
      include: { files: true },
    });

    if (!script) {
      return { blocked: true, reasons: ['Script not found'], nextActions: [] };
    }

    const policy = await this.getPolicyForApplication(script.applicationId);
    const reasons: string[] = [];
    const nextActions: string[] = [];

    const specFile = script.files.find((f) => f.role === 'SPEC');
    if (!specFile) {
      reasons.push('Script has no spec file to execute.');
      nextActions.push('Regenerate the script from its Automation Flow.');
    }

    // Playwright, Selenium, SAP GUI (VBScript), and HYBRID (a mix of the two)
    // all run in-app now — execution.service.ts's runLocked() dispatches all
    // four to their own runner. This used to also block SAP_VBSCRIPT/HYBRID
    // with a stale "VBScript generation isn't built yet" comment, which
    // silently made every SAP GUI script unexecutable from the Execute
    // button despite runSapGuiLocked/runHybridLocked existing and being unit
    // tested — only Cypress has no runner at all.
    const EXECUTABLE_FRAMEWORKS = new Set(['PLAYWRIGHT', 'SELENIUM', 'SAP_VBSCRIPT', 'HYBRID']);
    if (!EXECUTABLE_FRAMEWORKS.has(script.framework)) {
      reasons.push(`In-app execution doesn't support ${script.framework} yet.`);
      nextActions.push('Download the generated files and run them outside TestPilot.');
    }

    if (script.riskScore != null && script.riskScore > policy.maximumAllowedRiskScore) {
      const gotPct = Math.round(script.riskScore * 100);
      const maxPct = Math.round(policy.maximumAllowedRiskScore * 100);
      reasons.push(`Script risk score (${gotPct}%) exceeds the maximum allowed (${maxPct}%).`);
      nextActions.push('Review the AI findings and regenerate or manually approve the script.');
    }

    // Only enforced when AI review actually ran — same reasoning as
    // requireKnowledgeProcessed above: hard-blocking on AI approval when no
    // AI provider is reachable would make execution permanently impossible.
    const review = script.reviewJson as { aiReviewAvailable?: boolean; approved?: boolean } | null;
    if (policy.requireAiReviewPass && review?.aiReviewAvailable && review.approved === false) {
      reasons.push('AI review did not approve this script.');
      nextActions.push('Address the AI review findings before executing.');
    }

    return { blocked: reasons.length > 0, reasons, nextActions };
  }
}
