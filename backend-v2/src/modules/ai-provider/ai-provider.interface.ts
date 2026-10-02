export interface AiCompletion {
  content: string;
  raw?: unknown;
}

export interface AiGenerateOptions {
  system?: string;
  temperature?: number;
}

export interface AiProvider {
  readonly name: string;
  generateText(prompt: string, options?: AiGenerateOptions): Promise<AiCompletion>;
  generateJson<T = unknown>(prompt: string, options?: AiGenerateOptions): Promise<T>;
  generateEmbedding(text: string): Promise<number[]>;
  streamText(prompt: string, options?: AiGenerateOptions): AsyncIterable<string>;
  healthCheck(): Promise<{ healthy: boolean; detail?: string }>;
}
