import { Inject, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AI_PROVIDER_TOKEN } from '../ai-provider/ai-provider.tokens';
import type { AiProvider } from '../ai-provider/ai-provider.interface';

export interface RagRetrievalResult {
  chunks: string[];
  used: boolean;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// No external vector DB — this app runs SQLite locally (mirroring the
// Postgres→SQLite simplification made for the rest of the stack), so
// retrieval embeds the query, pulls this application's chunk embeddings into
// memory, and ranks them by cosine similarity in-process. Fine at this scale;
// would move to Qdrant/pgvector if a deployment's knowledge base grew large.
@Injectable()
export class RagService {
  private readonly logger = new Logger(RagService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider,
  ) {}

  async retrieveContext(applicationId: string, query: string, topK = 5): Promise<RagRetrievalResult> {
    let queryEmbedding: number[];
    try {
      queryEmbedding = await this.aiProvider.generateEmbedding(query);
    } catch (err) {
      this.logger.warn(`RAG retrieval unavailable (no embedding provider reachable): ${(err as Error).message}`);
      return { chunks: [], used: false };
    }

    const candidates = await this.prisma.knowledgeChunk.findMany({
      where: { applicationId, embeddingAvailable: true },
      select: { content: true, embedding: true },
    });
    if (candidates.length === 0) {
      return { chunks: [], used: false };
    }

    const ranked = candidates
      .map((c) => ({
        content: c.content,
        score: cosineSimilarity(queryEmbedding, (c.embedding as number[] | null) ?? []),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .filter((c) => c.score > 0);

    return { chunks: ranked.map((r) => r.content), used: ranked.length > 0 };
  }
}
