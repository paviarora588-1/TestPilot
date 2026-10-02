import { OpenAiCompatibleHttpProvider } from './openai-compatible-http.provider';

export class LlamaCppProvider extends OpenAiCompatibleHttpProvider {
  readonly name = 'llamacpp';
  protected baseUrl = process.env.LLAMACPP_BASE_URL ?? 'http://127.0.0.1:8080/v1';
  protected model = process.env.LLAMACPP_MODEL ?? 'local-model';
  // Legacy app runs embeddings off a second llama-server instance (same pattern used for its vision model).
  private readonly embeddingBaseUrl = process.env.LLAMACPP_EMBEDDING_BASE_URL ?? this.baseUrl;

  async generateEmbedding(text: string): Promise<number[]> {
    const res = await fetch(`${this.embeddingBaseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: text }),
    });
    if (!res.ok) {
      throw new Error(`llama.cpp embedding request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }
}
