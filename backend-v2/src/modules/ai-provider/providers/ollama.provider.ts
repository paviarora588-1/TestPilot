import { OpenAiCompatibleHttpProvider } from './openai-compatible-http.provider';

export class OllamaProvider extends OpenAiCompatibleHttpProvider {
  readonly name = 'ollama';
  protected baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434/v1';
  protected model = process.env.OLLAMA_MODEL ?? 'llama3.1';
  private readonly embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL ?? 'nomic-embed-text';

  async generateEmbedding(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.embeddingModel, input: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embedding request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    return data.data?.[0]?.embedding ?? [];
  }
}
