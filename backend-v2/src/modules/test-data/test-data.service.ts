import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { RagService } from '../rag/rag.service';
import { runCodexExec, parseCodexJson } from '../../common/codex-cli.util';
import { CreateDataBindingDto } from './dto/create-data-binding.dto';
import { CreateTestDataItemDto, UpdateTestDataItemDto } from './dto/create-test-data-item.dto';
import { CreateTestDataSetDto } from './dto/create-test-data-set.dto';
import { GenerateTestDataDto } from './dto/generate-test-data.dto';
import { PlaceholderResolverService } from './placeholder-resolver.service';
import { ParsedDataItem, parseTestDataCsv, parseTestDataExcel, parseTestDataJson } from './test-data-import.util';

interface AiGeneratedDataItem {
  key?: string;
  value?: string;
  isSensitive?: boolean;
}

interface AiGeneratedDataSet {
  name?: string;
  items?: AiGeneratedDataItem[];
}

@Injectable()
export class TestDataService {
  private readonly logger = new Logger(TestDataService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly placeholderResolver: PlaceholderResolverService,
    private readonly ragService: RagService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  // Data sets
  listSets(applicationId: string) {
    // Includes real `items` (not just `_count`) — the Automation Builder's
    // Step Inspector needs the actual item list to populate its "Test data
    // item" dropdown, and fetches sets via this same list endpoint.
    return this.prisma.testDataSet.findMany({
      where: { applicationId },
      include: { items: true, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getSet(id: string) {
    const set = await this.prisma.testDataSet.findUnique({ where: { id }, include: { items: true } });
    if (!set) throw new NotFoundException(`Test data set ${id} not found`);
    return set;
  }

  createSet(applicationId: string, dto: CreateTestDataSetDto) {
    return this.prisma.testDataSet.create({ data: { applicationId, ...dto } });
  }

  async deleteSet(id: string) {
    await this.getSet(id);
    await this.prisma.testDataSet.delete({ where: { id } });
    return { success: true };
  }

  // Data items
  async createItem(testDataSetId: string, dto: CreateTestDataItemDto) {
    await this.getSet(testDataSetId);
    return this.prisma.testDataItem.create({ data: { testDataSetId, ...dto, importedFrom: 'MANUAL' } });
  }

  async updateItem(id: string, dto: UpdateTestDataItemDto) {
    const item = await this.prisma.testDataItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Test data item ${id} not found`);
    return this.prisma.testDataItem.update({ where: { id }, data: dto });
  }

  async deleteItem(id: string) {
    const item = await this.prisma.testDataItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Test data item ${id} not found`);
    await this.prisma.testDataItem.delete({ where: { id } });
    return { success: true };
  }

  async resolveItem(id: string) {
    const item = await this.prisma.testDataItem.findUnique({ where: { id } });
    if (!item) throw new NotFoundException(`Test data item ${id} not found`);
    return { ...item, resolvedValue: this.placeholderResolver.resolve(item.value) };
  }

  supportedPlaceholders() {
    return this.placeholderResolver.listSupportedTokens();
  }

  private async importItems(testDataSetId: string, items: ParsedDataItem[], importedFrom: 'CSV' | 'EXCEL' | 'JSON') {
    await this.getSet(testDataSetId);
    const created: Awaited<ReturnType<typeof this.prisma.testDataItem.create>>[] = [];
    for (const item of items) {
      created.push(
        await this.prisma.testDataItem.create({
          data: { testDataSetId, key: item.key, value: item.value, importedFrom },
        }),
      );
    }
    return { imported: created.length, items: created };
  }

  importCsv(testDataSetId: string, buffer: Buffer) {
    return this.importItems(testDataSetId, parseTestDataCsv(buffer), 'CSV');
  }

  async importExcel(testDataSetId: string, buffer: Buffer) {
    return this.importItems(testDataSetId, await parseTestDataExcel(buffer), 'EXCEL');
  }

  importJson(testDataSetId: string, buffer: Buffer) {
    return this.importItems(testDataSetId, parseTestDataJson(buffer), 'JSON');
  }

  // Data bindings
  createBinding(applicationId: string, dto: CreateDataBindingDto) {
    return this.prisma.dataBinding.create({ data: { applicationId, ...dto } });
  }

  listBindingsForTestCase(testCaseId: string) {
    return this.prisma.dataBinding.findMany({ where: { testCaseId }, include: { testDataItem: true } });
  }

  async deleteBinding(id: string) {
    await this.prisma.dataBinding.delete({ where: { id } });
    return { success: true };
  }

  // Local AI creates a full, realistic data set on its own — grounded in
  // either a specific test case's steps (what values it actually needs) or
  // the application's input-type objects, plus Knowledge Base business rules
  // (e.g. password complexity) when available. Uses the app's own
  // placeholder tokens ({{randomEmail}}, {{timestamp}}, ...) for values that
  // must be unique per run, instead of a literal the AI invents once and
  // every re-run then collides on.
  async generateSetWithAi(applicationId: string, dto: GenerateTestDataDto) {
    const objects = await this.prisma.objectRepository.findMany({
      where: { applicationId, objectType: { contains: 'input' } },
    });

    const testCase = dto.testCaseId
      ? await this.prisma.testCase.findUnique({
          where: { id: dto.testCaseId },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        })
      : null;

    if (objects.length === 0 && !testCase) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['No input objects scanned and no test case given for this application.'],
        nextActions: ['Run the Scanner first, or generate data for a specific test case.'],
      });
    }

    const objectsText =
      objects.length > 0
        ? objects.map((o) => `- "${o.objectName}" (type: ${o.objectType})`).join('\n')
        : 'none scanned yet';
    const testCaseText = testCase
      ? `\n\nTest case "${testCase.title}" this data is for:\n${testCase.steps
          .map((s, i) => `${i + 1}. ${s.instruction}`)
          .join('\n')}${testCase.expectedResult ? `\nExpected result: ${testCase.expectedResult}` : ''}`
      : '';
    const focusText = dto.focus ? `\n\nFocus: ${dto.focus}` : '';

    const rag = await this.ragService.retrieveContext(
      applicationId,
      dto.focus || testCase?.title || 'test data business rules',
    );
    const ragContext = rag.used ? `\n\nKnowledge base context (business rules to respect):\n${rag.chunks.join('\n---\n')}` : '';

    const tokenDescriptions = this.placeholderResolver.describeSupportedTokens().join('\n');
    const count = Math.min(Math.max(dto.count ?? 6, 1), 20);

    let draft: AiGeneratedDataSet = {};
    try {
      draft = await this.aiProvider.generateJson<AiGeneratedDataSet>(
        `Input fields discovered for this application:\n${objectsText}${testCaseText}${focusText}${ragContext}`,
        {
          system:
            `You are a QA engineer preparing test data. Propose a data set of up to ${count} key-value items covering ` +
            'the input fields above. Return ONLY a JSON object: { "name": string (short set name), "items": ' +
            '[{ "key": string, "value": string, "isSensitive": boolean }] }. ' +
            `For a value that must be unique per test run, use whichever of these tokens actually matches that ` +
            `field's real-world meaning (never pick one just because a field "needs to vary" — a date token is only ` +
            `for genuinely date fields):\n${tokenDescriptions}\n` +
            'For a one-time visual code that cannot be known in advance (e.g. a CAPTCHA image), use the literal ' +
            'value "MANUAL_REVIEW_REQUIRED" rather than guessing a token or fabricated value, so a human knows to ' +
            'handle that field specially. Mark passwords, tokens, or other secret-like fields as isSensitive: true. ' +
            'Respect any business rules given above (e.g. minimum password length).',
        },
      );
    } catch (err) {
      this.logger.warn(`Test data generation unavailable for application ${applicationId}: ${(err as Error).message}`);
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`AI test data generation is unavailable right now: ${(err as Error).message}`],
        nextActions: ['Create a data set manually, or import one from CSV/Excel/JSON instead.'],
      });
    }

    const validItems = (Array.isArray(draft.items) ? draft.items : []).filter(
      (item): item is Required<AiGeneratedDataItem> => !!item.key && !!item.value,
    );
    if (validItems.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['The AI did not return any usable test data items.'],
        nextActions: ['Try again, or create a data set manually.'],
      });
    }

    const set = await this.prisma.testDataSet.create({
      data: {
        applicationId,
        name: dto.name || draft.name || testCase?.title || 'AI-generated data set',
        environment: dto.environment,
        description: testCase ? `AI-generated for test case "${testCase.title}".` : 'AI-generated from scanned input fields.',
        items: {
          create: validItems.map((item) => ({
            key: item.key,
            value: item.value,
            isSensitive: item.isSensitive ?? false,
            importedFrom: 'AI_GENERATED',
          })),
        },
      },
      include: { items: true },
    });

    return set;
  }

  // Codex-powered alternative to generateSetWithAi above — same context
  // (input objects, optional test case, focus text, Knowledge Base RAG
  // context, placeholder token catalog), same DTO shape, same validation and
  // TestDataSet/TestDataItem write path. Only the actual model call and the
  // resulting items' importedFrom marker differ.
  async generateSetWithCodex(applicationId: string, dto: GenerateTestDataDto) {
    const objects = await this.prisma.objectRepository.findMany({
      where: { applicationId, objectType: { contains: 'input' } },
    });

    const testCase = dto.testCaseId
      ? await this.prisma.testCase.findUnique({
          where: { id: dto.testCaseId },
          include: { steps: { orderBy: { stepOrder: 'asc' } } },
        })
      : null;

    if (objects.length === 0 && !testCase) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['No input objects scanned and no test case given for this application.'],
        nextActions: ['Run the Scanner first, or generate data for a specific test case.'],
      });
    }

    const objectsText =
      objects.length > 0
        ? objects.map((o) => `- "${o.objectName}" (type: ${o.objectType})`).join('\n')
        : 'none scanned yet';
    const testCaseText = testCase
      ? `\n\nTest case "${testCase.title}" this data is for:\n${testCase.steps
          .map((s, i) => `${i + 1}. ${s.instruction}`)
          .join('\n')}${testCase.expectedResult ? `\nExpected result: ${testCase.expectedResult}` : ''}`
      : '';
    const focusText = dto.focus ? `\n\nFocus: ${dto.focus}` : '';

    const rag = await this.ragService.retrieveContext(
      applicationId,
      dto.focus || testCase?.title || 'test data business rules',
    );
    const ragContext = rag.used ? `\n\nKnowledge base context (business rules to respect):\n${rag.chunks.join('\n---\n')}` : '';

    const tokenDescriptions = this.placeholderResolver.describeSupportedTokens().join('\n');
    const count = Math.min(Math.max(dto.count ?? 6, 1), 20);

    const system =
      `You are a QA engineer preparing test data. Propose a data set of up to ${count} key-value items covering ` +
      'the input fields given below. Return ONLY a JSON object: { "name": string (short set name), "items": ' +
      '[{ "key": string, "value": string, "isSensitive": boolean }] }. ' +
      `For a value that must be unique per test run, use whichever of these tokens actually matches that ` +
      `field's real-world meaning (never pick one just because a field "needs to vary" — a date token is only ` +
      `for genuinely date fields):\n${tokenDescriptions}\n` +
      'For a one-time visual code that cannot be known in advance (e.g. a CAPTCHA image), use the literal ' +
      'value "MANUAL_REVIEW_REQUIRED" rather than guessing a token or fabricated value, so a human knows to ' +
      'handle that field specially. Mark passwords, tokens, or other secret-like fields as isSensitive: true. ' +
      'Respect any business rules given above (e.g. minimum password length).';
    const userPrompt = `Input fields discovered for this application:\n${objectsText}${testCaseText}${focusText}${ragContext}`;

    let draft: AiGeneratedDataSet = {};
    const codexResult = await runCodexExec(system, userPrompt);
    if (codexResult.succeeded) {
      try {
        draft = parseCodexJson<AiGeneratedDataSet>(codexResult.content);
      } catch (err) {
        this.logger.warn(`Codex test data JSON parse failed for application ${applicationId}: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn(`Codex test data generation unavailable for application ${applicationId}: ${codexResult.errorMessage}`);
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: [`Codex test data generation is unavailable right now: ${codexResult.errorMessage}`],
        nextActions: ['Create a data set manually, or import one from CSV/Excel/JSON instead.'],
      });
    }

    const validItems = (Array.isArray(draft.items) ? draft.items : []).filter(
      (item): item is Required<AiGeneratedDataItem> => !!item.key && !!item.value,
    );
    if (validItems.length === 0) {
      throw new ConflictException({
        statusCode: 409,
        blocked: true,
        reasons: ['Codex did not return any usable test data items.'],
        nextActions: ['Try again, or create a data set manually.'],
      });
    }

    const set = await this.prisma.testDataSet.create({
      data: {
        applicationId,
        name: dto.name || draft.name || testCase?.title || 'Codex-generated data set',
        environment: dto.environment,
        description: testCase ? `Codex-generated for test case "${testCase.title}".` : 'Codex-generated from scanned input fields.',
        items: {
          create: validItems.map((item) => ({
            key: item.key,
            value: item.value,
            isSensitive: item.isSensitive ?? false,
            importedFrom: 'CODEX_AI_GENERATED',
          })),
        },
      },
      include: { items: true },
    });

    return set;
  }
}
