import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { RagService } from '../rag/rag.service';
import { decryptCredential, encryptCredential } from '../../common/crypto.util';
import { AnalyzeStoryDto } from './dto/analyze-story.dto';
import { CreateIntegrationConfigDto } from './dto/create-integration-config.dto';
import {
  fetchJiraIssue,
  fetchJiraIssues,
  fetchJiraIssueComments,
  fetchJiraIssueAttachments,
  downloadJiraAttachment,
} from './jira.client';
import { fetchZephyrTestCases } from './zephyr.client';
import { parseKnowledgeFile } from '../knowledge-base/file-parser.util';

interface StoredCredentials {
  apiToken: string;
  email?: string;
}

interface JiraDraftTestCase {
  title?: string;
  steps?: string[];
  expectedResult?: string;
}

const VALID_TEST_TYPES = new Set(['POSITIVE', 'NEGATIVE', 'BOUNDARY', 'UI', 'INTEGRATION', 'REGRESSION', 'SMOKE']);
const TEST_TYPE_ROTATION = ['POSITIVE', 'NEGATIVE', 'BOUNDARY', 'UI', 'INTEGRATION', 'REGRESSION', 'SMOKE'];

export interface StoryAnalysis {
  acceptanceCriteria?: string[];
  impactedModules?: string[];
  riskAreas?: string[];
  changeType?: 'NEW_FEATURE' | 'ENHANCEMENT' | 'DEFECT_FIX' | 'CONFIGURATION';
  whatIsChanging?: string;
}

// Caps keep the combined prompt bounded — the same local-model context-window
// pressure documented in TestCasesService.runGeneration applies here, just
// with attachments/comments as the new source of prompt bloat instead of a
// large Object Library.
const MAX_ATTACHMENTS_ANALYZED = 5;
const MAX_ATTACHMENT_CHARS = 4000;
const MAX_COMMENT_CHARS = 4000;
const PARSEABLE_ATTACHMENT_EXT = /\.(pdf|docx|xlsx|csv|txt|md)$/i;

interface AiGeneratedStoryTestCase {
  title?: string;
  moduleName?: string;
  featureName?: string;
  testType?: string;
  priority?: string;
  preconditions?: string;
  expectedResult?: string;
  automationRecommended?: boolean;
  automationRecommendedReason?: string;
  steps?: { instruction?: string; expectedResult?: string }[];
}

function maskConfig<T extends { credentialsEncrypted: string }>(config: T) {
  const { credentialsEncrypted: _credentialsEncrypted, ...rest } = config;
  return rest;
}

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  async createConfig(applicationId: string, dto: CreateIntegrationConfigDto) {
    const credentialsEncrypted = encryptCredential(
      JSON.stringify({ apiToken: dto.apiToken, email: dto.email } satisfies StoredCredentials),
    );
    const config = await this.prisma.integrationConfig.create({
      data: {
        applicationId,
        type: dto.type,
        baseUrl: dto.baseUrl,
        projectKey: dto.projectKey,
        credentialsEncrypted,
      },
    });
    return maskConfig(config);
  }

  async list(applicationId: string) {
    const configs = await this.prisma.integrationConfig.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
    return configs.map(maskConfig);
  }

  async remove(id: string) {
    await this.getConfigOrThrow(id);
    await this.prisma.integrationConfig.delete({ where: { id } });
    return { success: true };
  }

  listSyncLogs(configId: string) {
    return this.prisma.integrationSyncLog.findMany({
      where: { integrationConfigId: configId },
      orderBy: { startedAt: 'desc' },
    });
  }

  private async getConfigOrThrow(id: string) {
    const config = await this.prisma.integrationConfig.findUnique({ where: { id } });
    if (!config) throw new NotFoundException(`Integration config ${id} not found`);
    return config;
  }

  async sync(configId: string) {
    const config = await this.getConfigOrThrow(configId);
    const log = await this.prisma.integrationSyncLog.create({
      data: { integrationConfigId: configId, direction: 'IMPORT', status: 'RUNNING' },
    });

    try {
      const credentials = JSON.parse(decryptCredential(config.credentialsEncrypted)) as StoredCredentials;
      const itemsProcessed =
        config.type === 'ZEPHYR'
          ? await this.syncZephyr(config.applicationId, config.baseUrl, config.projectKey, credentials)
          : await this.syncJira(config.applicationId, config.baseUrl, config.projectKey, credentials);

      return this.prisma.integrationSyncLog.update({
        where: { id: log.id },
        data: { status: 'SUCCESS', itemsProcessed, finishedAt: new Date() },
      });
    } catch (err) {
      return this.prisma.integrationSyncLog.update({
        where: { id: log.id },
        data: { status: 'FAILED', errorMessage: (err as Error).message, finishedAt: new Date() },
      });
    }
  }

  private async syncZephyr(
    applicationId: string,
    baseUrl: string,
    projectKey: string | null,
    credentials: StoredCredentials,
  ) {
    const testCases = await fetchZephyrTestCases(baseUrl, credentials.apiToken, projectKey ?? '');
    for (const tc of testCases) {
      await this.prisma.testCase.create({
        data: {
          applicationId,
          externalId: tc.key,
          title: tc.name,
          preconditions: tc.precondition,
          expectedResult: tc.objective,
          source: 'ZEPHYR_API',
        },
      });
    }
    return testCases.length;
  }

  private async syncJira(
    applicationId: string,
    baseUrl: string,
    projectKey: string | null,
    credentials: StoredCredentials,
  ) {
    const issues = await fetchJiraIssues(baseUrl, credentials.email ?? '', credentials.apiToken, projectKey ?? '');
    for (const issue of issues) {
      let draft: JiraDraftTestCase | null = null;
      try {
        draft = await this.aiProvider.generateJson<JiraDraftTestCase>(
          `Jira issue ${issue.key}: ${issue.summary}\n${issue.description}`,
          {
            system:
              'Draft a QA test case from this Jira issue. Return JSON with keys: ' +
              'title (string), steps (string[] of test steps), expectedResult (string).',
          },
        );
      } catch {
        // AI drafting is best-effort — fall back to a bare test case from the issue summary.
      }

      await this.prisma.testCase.create({
        data: {
          applicationId,
          externalId: issue.key,
          title: draft?.title || issue.summary || issue.key,
          expectedResult: draft?.expectedResult,
          source: 'JIRA_AI_GENERATED',
          steps: draft?.steps?.length
            ? { create: draft.steps.map((instruction, index) => ({ stepOrder: index + 1, instruction })) }
            : undefined,
        },
      });
    }
    return issues.length;
  }

  // The "Jira Story → QA Flow" path: a single, real story is read deeply
  // (acceptance criteria, impacted modules, risk areas) and turned into
  // several categorized test cases, not the shallow one-shot draft `syncJira`
  // does for bulk project import. Reuses the one-object-per-AI-call pattern
  // proven in TestCasesService.generateWithAi — a small local model reliably
  // completes one bounded JSON object per call but truncates large arrays.
  async analyzeStory(configId: string, dto: AnalyzeStoryDto) {
    const config = await this.getConfigOrThrow(configId);
    if (config.type !== 'JIRA') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['Story analysis is only available for Jira integrations.'],
        nextActions: ['Connect a Jira Cloud integration to analyze a story.'],
      });
    }
    const credentials = JSON.parse(decryptCredential(config.credentialsEncrypted)) as StoredCredentials;

    let issue;
    try {
      issue = await fetchJiraIssue(config.baseUrl, credentials.email ?? '', credentials.apiToken, dto.issueKey);
    } catch (err) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Could not fetch Jira issue ${dto.issueKey}: ${(err as Error).message}`],
        nextActions: ['Confirm the issue key and that the connected credentials have access to it.'],
      });
    }

    // Comments and attachments are best-effort context, not preconditions —
    // a story with no comments or no attachments is completely normal, so
    // failures here are logged and degrade to "none found" rather than
    // blocking analysis the way a failed core issue fetch does above.
    let comments: Awaited<ReturnType<typeof fetchJiraIssueComments>> = [];
    try {
      comments = await fetchJiraIssueComments(config.baseUrl, credentials.email ?? '', credentials.apiToken, dto.issueKey);
    } catch (err) {
      this.logger.warn(`Could not fetch comments for ${dto.issueKey}: ${(err as Error).message}`);
    }

    const attachmentTexts: { filename: string; text: string }[] = [];
    try {
      const attachments = await fetchJiraIssueAttachments(config.baseUrl, credentials.email ?? '', credentials.apiToken, dto.issueKey);
      const parseable = attachments.filter((a) => PARSEABLE_ATTACHMENT_EXT.test(a.filename)).slice(0, MAX_ATTACHMENTS_ANALYZED);
      for (const att of parseable) {
        try {
          const buffer = await downloadJiraAttachment(credentials.email ?? '', credentials.apiToken, att.contentUrl);
          const { text } = await parseKnowledgeFile(buffer, att.filename);
          if (text.trim()) attachmentTexts.push({ filename: att.filename, text: text.slice(0, MAX_ATTACHMENT_CHARS) });
        } catch (err) {
          this.logger.warn(`Could not parse attachment "${att.filename}" on ${dto.issueKey}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Could not fetch attachments for ${dto.issueKey}: ${(err as Error).message}`);
    }

    const rag = await this.ragService.retrieveContext(config.applicationId, `${issue.summary}\n${issue.description}`);
    const ragContext = rag.used ? `\n\nRelevant knowledge base context:\n${rag.chunks.join('\n---\n')}` : '';

    const fieldsText =
      `Labels: ${issue.labels.join(', ') || 'none'}\n` +
      `Components: ${issue.components.join(', ') || 'none'}\n` +
      `Priority: ${issue.priority ?? 'n/a'} | Status: ${issue.status ?? 'n/a'}` +
      (issue.epicKey ? `\nEpic: ${issue.epicKey}` : '') +
      (issue.linkedIssues.length > 0
        ? `\nLinked issues: ${issue.linkedIssues.map((l) => `${l.key} (${l.relationship}${l.summary ? `: ${l.summary}` : ''})`).join('; ')}`
        : '');

    const commentsText =
      comments.length > 0
        ? `\n\nComments (${comments.length}, most recent first — may contain clarifications, scope changes, or edge cases not in the description):\n` +
          comments
            .map((c) => `[${c.author}] ${c.body}`)
            .join('\n---\n')
            .slice(0, MAX_COMMENT_CHARS)
        : '';

    const attachmentsText =
      attachmentTexts.length > 0
        ? `\n\nAttachment excerpts:\n` + attachmentTexts.map((a) => `From "${a.filename}":\n${a.text}`).join('\n---\n')
        : '';

    const storyText =
      `Jira issue ${issue.key}: ${issue.summary}\n\n${fieldsText}\n\nDescription:\n${issue.description}` +
      (issue.acceptanceCriteria ? `\n\nAcceptance criteria (as written in the story):\n${issue.acceptanceCriteria}` : '') +
      commentsText +
      attachmentsText +
      ragContext;

    let storyAnalysis: StoryAnalysis = {};
    try {
      storyAnalysis = await this.aiProvider.generateJson<StoryAnalysis>(storyText, {
        system:
          'You are a senior QA engineer analyzing a Jira story before writing test cases — you are given the full ' +
          'story (fields, description, comments, and attachment excerpts), not just a summary. Return ONLY a JSON object: ' +
          '{ "acceptanceCriteria": string[] (inferred if not explicitly written), "impactedModules": string[], ' +
          '"riskAreas": string[] (areas most likely to break or need careful testing), ' +
          '"changeType": one of "NEW_FEATURE"|"ENHANCEMENT"|"DEFECT_FIX"|"CONFIGURATION" (best judgment from the fields/description), ' +
          '"whatIsChanging": string (one sentence: what is actually changing and why, in plain QA language) }.',
      });
    } catch (err) {
      this.logger.warn(`Story analysis unavailable for ${dto.issueKey}: ${(err as Error).message}`);
    }

    const analysisContext =
      `${storyText}\n\nAnalysis so far — acceptance criteria: ${(storyAnalysis.acceptanceCriteria ?? []).join('; ') || 'n/a'}; ` +
      `impacted modules: ${(storyAnalysis.impactedModules ?? []).join(', ') || 'n/a'}; ` +
      `risk areas: ${(storyAnalysis.riskAreas ?? []).join(', ') || 'n/a'}.`;

    const system =
      'You are a senior QA engineer. Propose ONE test case for this Jira story. Return ONLY a single JSON object ' +
      '(no array, no wrapper): { "title": string, "moduleName": string, "featureName": string, ' +
      '"testType": "POSITIVE"|"NEGATIVE"|"BOUNDARY"|"UI"|"INTEGRATION"|"REGRESSION"|"SMOKE", ' +
      '"priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "preconditions": string, "expectedResult": string, ' +
      '"automationRecommended": boolean, "automationRecommendedReason": string, ' +
      '"steps": [{ "instruction": string, "expectedResult": string }] }.';

    const count = Math.min(Math.max(dto.count ?? 6, 1), 15);
    const titlesSoFar: string[] = [];
    const created: Awaited<ReturnType<typeof this.prisma.testCase.create>>[] = [];
    let lastError: string | null = null;

    for (let i = 0; i < count; i++) {
      const testType = TEST_TYPE_ROTATION[i % TEST_TYPE_ROTATION.length];
      const dedupeText =
        titlesSoFar.length > 0 ? `\n\nDo not duplicate these test cases already proposed:\n${titlesSoFar.map((t) => `- ${t}`).join('\n')}` : '';
      try {
        const tc = await this.aiProvider.generateJson<AiGeneratedStoryTestCase>(
          `${analysisContext}${dedupeText}\n\nThis test case must be of type: ${testType}.`,
          { system },
        );
        const isDuplicate = tc.title && titlesSoFar.some((t) => t.trim().toLowerCase() === tc.title!.trim().toLowerCase());
        if (tc.title && Array.isArray(tc.steps) && tc.steps.length > 0 && !isDuplicate) {
          titlesSoFar.push(tc.title);
          const testCase = await this.prisma.testCase.create({
            data: {
              applicationId: config.applicationId,
              externalId: issue.key,
              title: tc.title,
              moduleName: tc.moduleName || undefined,
              featureName: tc.featureName || undefined,
              testType: (VALID_TEST_TYPES.has(tc.testType ?? '') ? tc.testType : testType) as never,
              priority: (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(tc.priority ?? '') ? tc.priority : 'MEDIUM') as never,
              preconditions: tc.preconditions || undefined,
              expectedResult: tc.expectedResult || undefined,
              automationRecommended: tc.automationRecommended ?? null,
              automationRecommendedReason: tc.automationRecommendedReason || undefined,
              source: 'JIRA_AI_GENERATED',
              steps: {
                create: tc.steps
                  .filter((s) => s.instruction)
                  .map((s, index) => ({
                    stepOrder: index + 1,
                    instruction: s.instruction!,
                    expectedResult: s.expectedResult || undefined,
                  })),
              },
            },
            include: { steps: { orderBy: { stepOrder: 'asc' } } },
          });
          created.push(testCase);
        }
      } catch (err) {
        lastError = (err as Error).message;
        this.logger.warn(`Story test case ${i + 1}/${count} unavailable for ${dto.issueKey}: ${lastError}`);
      }
    }

    if (created.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [
          lastError
            ? `AI test case generation is unavailable right now: ${lastError}`
            : 'The AI did not return any usable test cases for this story.',
        ],
        nextActions: ['Try again, or create test cases manually from the story.'],
      });
    }

    return {
      issue,
      storyAnalysis,
      contextGathered: { commentsAnalyzed: comments.length, attachmentsAnalyzed: attachmentTexts.length },
      created: created.length,
      testCases: created,
    };
  }
}
