import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { RagService } from '../rag/rag.service';
import { decryptCredential } from '../../common/crypto.util';
import { parseKnowledgeFile } from '../knowledge-base/file-parser.util';
import {
  fetchJiraIssue,
  fetchJiraIssueAttachments,
  fetchJiraIssueComments,
  downloadJiraAttachment,
} from '../integrations/jira.client';
import { parseCodexJson, runCodexExec } from '../../common/codex-cli.util';

interface StoredCredentials {
  apiToken: string;
  email?: string;
}

// Deliberately re-declared here rather than imported from
// integrations.service.ts, and deliberately kept in lockstep with it by
// hand — see this module's schema comment (JiraStoryImport) for why this
// stays a separate, internal-only path instead of sharing the customer-
// facing service's internals: the whole point is that this module can
// route through Codex without that ever becoming reachable from a
// customer-triggered code path.
const VALID_TEST_TYPES = new Set(['POSITIVE', 'NEGATIVE', 'BOUNDARY', 'UI', 'INTEGRATION', 'REGRESSION', 'SMOKE']);
const TEST_TYPE_ROTATION = ['POSITIVE', 'NEGATIVE', 'BOUNDARY', 'UI', 'INTEGRATION', 'REGRESSION'] as const;
const MAX_ATTACHMENTS_ANALYZED = 5;
const MAX_ATTACHMENT_CHARS = 4000;
const MAX_COMMENT_CHARS = 4000;
const PARSEABLE_ATTACHMENT_EXT = /\.(pdf|docx|xlsx|csv|txt|md)$/i;
const MAX_IMAGES_ANALYZED = 5;
const IMAGE_ATTACHMENT_EXT = /\.(png|jpe?g|gif|bmp|webp)$/i;

interface StoryAnalysis {
  acceptanceCriteria?: string[];
  impactedModules?: string[];
  riskAreas?: string[];
  changeType?: string;
  whatIsChanging?: string;
}

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

// Accepts a full story link (https://your-company.atlassian.net/browse/PN-217)
// or a bare issue key (PN-217).
function parseIssueKey(storyUrlOrKey: string): string {
  const trimmed = storyUrlOrKey.trim();
  const urlMatch = trimmed.match(/\/browse\/([A-Za-z][A-Za-z0-9]*-\d+)/);
  if (urlMatch) return urlMatch[1].toUpperCase();
  const bareMatch = trimmed.match(/^([A-Za-z][A-Za-z0-9]*-\d+)$/);
  if (bareMatch) return bareMatch[1].toUpperCase();
  throw new ConflictException({
    statusCode: 409,
    blocked: true,
    reasons: [`"${storyUrlOrKey}" doesn't look like a Jira story link or issue key.`],
    nextActions: ['Paste a full story link (.../browse/PN-217) or just the issue key (PN-217).'],
  });
}

@Injectable()
export class JiraCodexImportService {
  private readonly logger = new Logger(JiraCodexImportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ragService: RagService,
  ) {}

  async list(applicationId: string) {
    return this.prisma.jiraStoryImport.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: string) {
    const record = await this.prisma.jiraStoryImport.findUnique({
      where: { id },
      include: { prompts: { orderBy: { createdAt: 'asc' } } },
    });
    if (!record) throw new NotFoundException(`Jira story import ${id} not found`);
    return record;
  }

  // Stage 1: fetch the story in full (issue + comments + attachments + KB
  // context), store the RAW combined text (the actual tracking gap this
  // module exists to close — analyzeStory() never persists this), then run
  // ONE Codex call to analyze it, storing that prompt+response too.
  async createImport(applicationId: string, integrationConfigId: string, storyUrlOrKey: string, createdById?: string) {
    const issueKey = parseIssueKey(storyUrlOrKey);
    const config = await this.prisma.integrationConfig.findUnique({ where: { id: integrationConfigId } });
    if (!config || config.applicationId !== applicationId) {
      throw new NotFoundException(`Integration config ${integrationConfigId} not found for this application`);
    }
    if (config.type !== 'JIRA') {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['Story import is only available for Jira integrations.'],
        nextActions: [],
      });
    }
    const credentials = JSON.parse(decryptCredential(config.credentialsEncrypted)) as StoredCredentials;

    let issue;
    try {
      issue = await fetchJiraIssue(config.baseUrl, credentials.email ?? '', credentials.apiToken, issueKey);
    } catch (err) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Could not fetch Jira issue ${issueKey}: ${(err as Error).message}`],
        nextActions: ['Confirm the issue key and that the connected credentials have access to it.'],
      });
    }

    let comments: Awaited<ReturnType<typeof fetchJiraIssueComments>> = [];
    try {
      comments = await fetchJiraIssueComments(config.baseUrl, credentials.email ?? '', credentials.apiToken, issueKey);
    } catch (err) {
      this.logger.warn(`Could not fetch comments for ${issueKey}: ${(err as Error).message}`);
    }

    const attachmentTexts: { filename: string; text: string }[] = [];
    const imagePaths: string[] = [];
    const imageNames: string[] = [];
    try {
      const attachments = await fetchJiraIssueAttachments(config.baseUrl, credentials.email ?? '', credentials.apiToken, issueKey);
      const parseable = attachments.filter((a) => PARSEABLE_ATTACHMENT_EXT.test(a.filename)).slice(0, MAX_ATTACHMENTS_ANALYZED);
      for (const att of parseable) {
        try {
          const buffer = await downloadJiraAttachment(credentials.email ?? '', credentials.apiToken, att.contentUrl);
          const { text } = await parseKnowledgeFile(buffer, att.filename);
          if (text.trim()) attachmentTexts.push({ filename: att.filename, text: text.slice(0, MAX_ATTACHMENT_CHARS) });
        } catch (err) {
          this.logger.warn(`Could not parse attachment "${att.filename}" on ${issueKey}: ${(err as Error).message}`);
        }
      }

      // Screenshots are how most SAP GUI bugs actually get reported (a blank
      // field, a wrong value on screen) — these used to be silently dropped
      // by the filter above. Codex CLI's own `-i` flag does genuine image
      // analysis (confirmed against a real screenshot before wiring this
      // in), so download these to temp files and hand them to Stage 1's
      // analysis call below instead.
      const imageAttachments = attachments.filter((a) => IMAGE_ATTACHMENT_EXT.test(a.filename)).slice(0, MAX_IMAGES_ANALYZED);
      for (const att of imageAttachments) {
        try {
          const buffer = await downloadJiraAttachment(credentials.email ?? '', credentials.apiToken, att.contentUrl);
          const tempPath = path.join(os.tmpdir(), `jira-image-${randomUUID()}${path.extname(att.filename) || '.png'}`);
          await fs.writeFile(tempPath, buffer);
          imagePaths.push(tempPath);
          imageNames.push(att.filename);
        } catch (err) {
          this.logger.warn(`Could not download image attachment "${att.filename}" on ${issueKey}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      this.logger.warn(`Could not fetch attachments for ${issueKey}: ${(err as Error).message}`);
    }

    const rag = await this.ragService.retrieveContext(applicationId, `${issue.summary}\n${issue.description}`);
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
        ? `\n\nComments (${comments.length}, most recent first):\n` +
          comments.map((c) => `[${c.author}] ${c.body}`).join('\n---\n').slice(0, MAX_COMMENT_CHARS)
        : '';
    const attachmentsText =
      attachmentTexts.length > 0
        ? `\n\nAttachment excerpts:\n` + attachmentTexts.map((a) => `From "${a.filename}":\n${a.text}`).join('\n---\n')
        : '';
    // The images themselves aren't representable as text, but naming them
    // here keeps rawContent an honest record of everything actually sent to
    // Codex for this story (same reasoning as attachmentsText above).
    const imagesText =
      imageNames.length > 0
        ? `\n\nScreenshot attachments (${imageNames.length}, examined visually by Codex): ${imageNames.join(', ')}`
        : '';

    // This is the raw content this whole module exists to track — stored
    // verbatim, independent of whether the Codex call below succeeds.
    const rawContent =
      `Jira issue ${issue.key}: ${issue.summary}\n\n${fieldsText}\n\nDescription:\n${issue.description}` +
      (issue.acceptanceCriteria ? `\n\nAcceptance criteria (as written in the story):\n${issue.acceptanceCriteria}` : '') +
      commentsText +
      attachmentsText +
      imagesText +
      ragContext;

    const record = await this.prisma.jiraStoryImport.create({
      data: {
        applicationId,
        integrationConfigId,
        issueKey,
        storyUrl: `${config.baseUrl.replace(/\/$/, '')}/browse/${issueKey}`,
        rawContent,
        status: 'FETCHED',
        createdById,
      },
    });

    const stage1System =
      'You are a senior QA engineer analyzing a Jira story before writing test cases — you are given the full ' +
      'story (fields, description, comments, and attachment excerpts), not just a summary' +
      (imagePaths.length > 0
        ? `, plus ${imagePaths.length} screenshot(s) attached to the story — examine them for the actual on-screen ` +
          'behavior being reported (blank fields, wrong values, error dialogs) and factor that into your analysis'
        : '') +
      '. Return ONLY a JSON object: ' +
      '{ "acceptanceCriteria": string[] (inferred if not explicitly written), "impactedModules": string[], ' +
      '"riskAreas": string[] (areas most likely to break or need careful testing), ' +
      '"changeType": one of "NEW_FEATURE"|"ENHANCEMENT"|"DEFECT_FIX"|"CONFIGURATION" (best judgment from the fields/description), ' +
      '"whatIsChanging": string (one sentence: what is actually changing and why, in plain QA language) }.';

    let codexResult: Awaited<ReturnType<typeof runCodexExec>>;
    try {
      codexResult = await runCodexExec(stage1System, rawContent, undefined, imagePaths.length > 0 ? imagePaths : undefined);
    } finally {
      for (const p of imagePaths) {
        await fs.unlink(p).catch(() => undefined);
      }
    }
    await this.prisma.jiraStoryPrompt.create({
      data: {
        jiraStoryImportId: record.id,
        stage: 'STORY_ANALYSIS',
        systemPrompt: stage1System,
        userPrompt: rawContent,
        rawResponse: codexResult.content || codexResult.errorMessage || null,
        succeeded: codexResult.succeeded,
      },
    });

    let storyAnalysisJson: StoryAnalysis | undefined;
    if (codexResult.succeeded) {
      try {
        storyAnalysisJson = parseCodexJson<StoryAnalysis>(codexResult.content);
      } catch (err) {
        this.logger.warn(`Story analysis JSON parse failed for import ${record.id}: ${(err as Error).message}`);
      }
    }

    return this.prisma.jiraStoryImport.update({
      where: { id: record.id },
      data: {
        status: storyAnalysisJson ? 'FETCHED' : 'FAILED',
        storyAnalysisJson: (storyAnalysisJson ?? null) as never,
        errorMessage: storyAnalysisJson ? null : codexResult.errorMessage ?? 'Story analysis did not return usable JSON.',
      },
      include: { prompts: { orderBy: { createdAt: 'asc' } } },
    });
  }

  // Stage 2: one Codex call per test type, each stored as its own prompt
  // row (so exactly what was sent/received per generated test case is
  // inspectable), each creating a real TestCase row (source
  // JIRA_AI_GENERATED, same shape IntegrationsService.analyzeStory() uses)
  // on success.
  async generateTestCases(importId: string) {
    const record = await this.get(importId);
    if (!record.storyAnalysisJson) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['This import has no usable story analysis yet — re-run the import first.'],
        nextActions: [],
      });
    }

    await this.prisma.jiraStoryImport.update({ where: { id: importId }, data: { status: 'GENERATING' } });

    const analysis = record.storyAnalysisJson as StoryAnalysis;
    const analysisContext =
      `${record.rawContent}\n\nAnalysis so far — acceptance criteria: ${(analysis.acceptanceCriteria ?? []).join('; ') || 'n/a'}; ` +
      `impacted modules: ${(analysis.impactedModules ?? []).join(', ') || 'n/a'}; ` +
      `risk areas: ${(analysis.riskAreas ?? []).join(', ') || 'n/a'}.`;

    const stage2System =
      'You are a senior QA engineer. Propose ONE test case for this Jira story. Return ONLY a single JSON object ' +
      '(no array, no wrapper): { "title": string, "moduleName": string, "featureName": string, ' +
      '"testType": "POSITIVE"|"NEGATIVE"|"BOUNDARY"|"UI"|"INTEGRATION"|"REGRESSION"|"SMOKE", ' +
      '"priority": "LOW"|"MEDIUM"|"HIGH"|"CRITICAL", "preconditions": string, "expectedResult": string, ' +
      '"automationRecommended": boolean, "automationRecommendedReason": string, ' +
      '"steps": [{ "instruction": string, "expectedResult": string }] }.';

    const existing = await this.prisma.testCase.findMany({ where: { applicationId: record.applicationId }, select: { title: true } });
    const titlesSoFar = existing.map((t) => t.title);
    const created: string[] = [];

    for (const testType of TEST_TYPE_ROTATION) {
      const dedupeText = titlesSoFar.length > 0 ? `\n\nDo not duplicate these test cases already proposed:\n${titlesSoFar.map((t) => `- ${t}`).join('\n')}` : '';
      const userPrompt = `${analysisContext}${dedupeText}\n\nThis test case must be of type: ${testType}.`;
      const codexResult = await runCodexExec(stage2System, userPrompt);

      let tc: AiGeneratedStoryTestCase | undefined;
      if (codexResult.succeeded) {
        try {
          tc = parseCodexJson<AiGeneratedStoryTestCase>(codexResult.content);
        } catch (err) {
          this.logger.warn(`Test case JSON parse failed (${testType}) for import ${importId}: ${(err as Error).message}`);
        }
      }

      await this.prisma.jiraStoryPrompt.create({
        data: {
          jiraStoryImportId: importId,
          stage: 'TEST_CASE',
          label: testType,
          systemPrompt: stage2System,
          userPrompt,
          rawResponse: codexResult.content || codexResult.errorMessage || null,
          succeeded: !!tc?.title && Array.isArray(tc.steps) && tc.steps.length > 0,
        },
      });

      const isDuplicate = tc?.title && titlesSoFar.some((t) => t.trim().toLowerCase() === tc!.title!.trim().toLowerCase());
      if (tc?.title && Array.isArray(tc.steps) && tc.steps.length > 0 && !isDuplicate) {
        titlesSoFar.push(tc.title);
        await this.prisma.testCase.create({
          data: {
            applicationId: record.applicationId,
            externalId: record.issueKey,
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
                .map((s, index) => ({ stepOrder: index + 1, instruction: s.instruction!, expectedResult: s.expectedResult || undefined })),
            },
          },
        });
        created.push(tc.title);
      }
    }

    return this.prisma.jiraStoryImport.update({
      where: { id: importId },
      data: { status: created.length > 0 ? 'COMPLETED' : 'FAILED', errorMessage: created.length > 0 ? null : 'No test cases were generated.' },
      include: { prompts: { orderBy: { createdAt: 'asc' } } },
    });
  }
}
