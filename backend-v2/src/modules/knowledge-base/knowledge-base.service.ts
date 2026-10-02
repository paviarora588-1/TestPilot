import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';
import { chunkText } from './chunking.util';
import { parseKnowledgeFile } from './file-parser.util';

const STORAGE_ROOT = path.join(process.cwd(), 'storage', 'knowledge');

interface KnowledgeExtraction {
  modules?: string[];
  validations?: string[];
  gaps?: string[];
}

@Injectable()
export class KnowledgeBaseService {
  private readonly logger = new Logger(KnowledgeBaseService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  list(applicationId: string) {
    return this.prisma.knowledgeSource.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'desc' },
      include: { summary: true },
    });
  }

  async get(id: string) {
    const source = await this.prisma.knowledgeSource.findUnique({
      where: { id },
      include: { summary: true, chunks: { orderBy: { chunkIndex: 'asc' }, take: 3 } },
    });
    if (!source) throw new NotFoundException(`Knowledge source ${id} not found`);
    return source;
  }

  async remove(id: string) {
    const source = await this.get(id);
    await fs.rm(source.filePath, { force: true }).catch(() => undefined);
    await this.prisma.knowledgeSource.delete({ where: { id } });
    return { success: true };
  }

  async upload(applicationId: string, file: Express.Multer.File) {
    const sourceDir = path.join(STORAGE_ROOT, applicationId, randomUUID());
    await fs.mkdir(sourceDir, { recursive: true });
    const filePath = path.join(sourceDir, file.originalname);
    await fs.writeFile(filePath, file.buffer);

    const source = await this.prisma.knowledgeSource.create({
      data: {
        applicationId,
        fileName: file.originalname,
        fileType: 'TEXT',
        filePath,
        status: 'PENDING',
      },
    });

    // Fire-and-forget, same honest-degradation pattern as script review: the
    // upload response comes back immediately, parsing/embedding/AI-summary
    // happen in the background and the source's status reflects real progress.
    this.processSource(source.id).catch((err) => {
      this.logger.error(`Knowledge source ${source.id} processing crashed: ${(err as Error).message}`);
    });

    return this.get(source.id);
  }

  // Same ingestion pipeline as upload() (chunk, embed, AI-summarize into
  // KnowledgeSummary) but for text synthesized in-process rather than a
  // user-uploaded file — used by TestCasesService to fold existing test
  // cases into the Knowledge Base. Awaited (not fire-and-forget) because the
  // caller needs the resulting KnowledgeSummary available before it reads
  // knowledgeSummaries back out for generation grounding.
  async ingestText(applicationId: string, fileName: string, text: string) {
    const sourceDir = path.join(STORAGE_ROOT, applicationId, randomUUID());
    await fs.mkdir(sourceDir, { recursive: true });
    const filePath = path.join(sourceDir, fileName);
    await fs.writeFile(filePath, text, 'utf-8');

    const source = await this.prisma.knowledgeSource.create({
      data: { applicationId, fileName, fileType: 'TEXT', filePath, status: 'PENDING' },
    });

    await this.processSource(source.id);
    return this.get(source.id);
  }

  private async processSource(sourceId: string) {
    const source = await this.prisma.knowledgeSource.findUniqueOrThrow({ where: { id: sourceId } });
    await this.prisma.knowledgeSource.update({ where: { id: sourceId }, data: { status: 'PROCESSING' } });

    try {
      const buffer = await fs.readFile(source.filePath);
      const { text, fileType } = await parseKnowledgeFile(buffer, source.fileName);
      const chunks = chunkText(text);

      if (chunks.length === 0) {
        await this.prisma.knowledgeSource.update({
          where: { id: sourceId },
          data: { status: 'FAILED', errorMessage: 'No extractable text found in this file.', fileType },
        });
        return;
      }

      for (let i = 0; i < chunks.length; i++) {
        let embedding: number[] | null = null;
        let embeddingAvailable = false;
        try {
          embedding = await this.aiProvider.generateEmbedding(chunks[i]);
          embeddingAvailable = true;
        } catch (err) {
          if (i === 0) {
            this.logger.warn(`Embeddings unavailable for source ${sourceId}: ${(err as Error).message}`);
          }
        }
        await this.prisma.knowledgeChunk.create({
          data: {
            knowledgeSourceId: sourceId,
            applicationId: source.applicationId,
            chunkIndex: i,
            content: chunks[i],
            embedding: embedding as never,
            embeddingAvailable,
          },
        });
      }

      let extraction: KnowledgeExtraction | null = null;
      let aiEnrichmentAvailable = false;
      try {
        extraction = await this.aiProvider.generateJson<KnowledgeExtraction>(
          `Document: ${source.fileName}\n\n${text.slice(0, 8000)}`,
          {
            system:
              'You are a QA analyst extracting structure from a product knowledge document. ' +
              'Return JSON with keys: modules (string[] of application modules/screens this document describes), ' +
              'validations (string[] of business rules or validations mentioned), ' +
              'gaps (string[] of anything ambiguous or missing that a QA engineer should follow up on).',
          },
        );
        aiEnrichmentAvailable = true;
      } catch (err) {
        this.logger.warn(`AI summary unavailable for source ${sourceId}: ${(err as Error).message}`);
      }

      await this.prisma.knowledgeSummary.upsert({
        where: { knowledgeSourceId: sourceId },
        create: {
          knowledgeSourceId: sourceId,
          modules: (extraction?.modules ?? []) as never,
          validations: (extraction?.validations ?? []) as never,
          gaps: (extraction?.gaps ?? []) as never,
          aiEnrichmentAvailable,
        },
        update: {
          modules: (extraction?.modules ?? []) as never,
          validations: (extraction?.validations ?? []) as never,
          gaps: (extraction?.gaps ?? []) as never,
          aiEnrichmentAvailable,
        },
      });

      await this.prisma.knowledgeSource.update({
        where: { id: sourceId },
        data: { status: 'PROCESSED', chunkCount: chunks.length, fileType },
      });
    } catch (err) {
      await this.prisma.knowledgeSource.update({
        where: { id: sourceId },
        data: { status: 'FAILED', errorMessage: (err as Error).message },
      });
    }
  }
}
