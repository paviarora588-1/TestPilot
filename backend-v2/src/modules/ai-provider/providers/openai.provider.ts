import OpenAI from 'openai';
import { AiCompletion, AiGenerateOptions, AiProvider } from '../ai-provider.interface';
import { parseJsonLoose } from '../json-repair.util';

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;
  private readonly model: string;
  private readonly embeddingModel: string;

  constructor() {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is missing. Real AI mode requires a valid OpenAI API key.');
    }
    this.client = new OpenAI({ apiKey });
    this.model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
    this.embeddingModel = process.env.OPENAI_EMBEDDING_MODEL ?? 'text-embedding-3-small';
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

  async generateEmbedding(text: string): Promise<number[]> {
    const res = await this.client.embeddings.create({ model: this.embeddingModel, input: text });
    return res.data[0]?.embedding ?? [];
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
