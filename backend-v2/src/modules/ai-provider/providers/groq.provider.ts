import OpenAI from 'openai';
import { AiCompletion, AiGenerateOptions, AiProvider } from '../ai-provider.interface';
import { parseJsonLoose } from '../json-repair.util';

// Groq's API is a deliberate drop-in replacement for the OpenAI chat-completions
// format (https://console.groq.com/docs/openai) — same `openai` SDK as
// OpenAiProvider, just pointed at Groq's baseURL and key. The one real
// difference: Groq has no embeddings endpoint, so generateEmbedding throws
// rather than silently returning garbage — every existing caller
// (rag.service.ts, knowledge-base.service.ts) already wraps embedding calls
// in try/catch and degrades gracefully (embeddingAvailable: false), the same
// path already exercised when Ollama's embedding model isn't reachable.
export class GroqProvider implements AiProvider {
  readonly name = 'groq';
  private readonly client: OpenAI;
  private readonly model: string;

  constructor() {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('GROQ_API_KEY is missing. AI_PROVIDER=groq requires a valid Groq API key.');
    }
    this.client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
    this.model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';
  }

  async generateText(prompt: string, options?: AiGenerateOptions): Promise<AiCompletion> {
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      ...(options?.system ? [{ role: 'system' as const, content: options.system }] : []),
      { role: 'user' as const, content: prompt },
    ];
    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: options?.temperature ?? 0.2,
    });
    return { content: completion.choices[0]?.message?.content ?? '', raw: completion };
  }

  async generateJson<T = unknown>(prompt: string, options?: AiGenerateOptions): Promise<T> {
    const completion = await this.generateText(prompt, {
      ...options,
      system: `${options?.system ?? ''}\nRespond with valid JSON only, no markdown fences, no prose.`.trim(),
    });
    return parseJsonLoose<T>(completion.content);
  }

  async generateEmbedding(): Promise<number[]> {
    throw new Error('Groq has no embeddings API — set AI_PROVIDER=groq alongside a separate embedding source, or use a different provider for embedding-dependent features.');
  }

  async *streamText(prompt: string, options?: AiGenerateOptions): AsyncIterable<string> {
    const completion = await this.generateText(prompt, options);
    yield completion.content;
  }

  async healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    try {
      await this.client.models.list();
      return { healthy: true };
    } catch (err) {
      return { healthy: false, detail: (err as Error).message };
    }
  }
}
