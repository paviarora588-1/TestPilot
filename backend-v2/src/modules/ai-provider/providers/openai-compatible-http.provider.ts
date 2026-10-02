import { Logger } from '@nestjs/common';
import { Agent, setGlobalDispatcher } from 'undici';
import { AiCompletion, AiGenerateOptions, AiProvider } from '../ai-provider.interface';
import { parseJsonLoose } from '../json-repair.util';

const logger = new Logger('AiProvider');

// Every other network call in this class (healthCheck) already had a timeout;
// generateText — the one actually used for every test case / test data /
// flow generation call — didn't, so a hung or overloaded local Ollama
// instance (e.g. two generation jobs firing concurrent requests at a
// single-threaded local model) left the request pending forever: no error,
// no timeout, the calling job just sat at the same progress step
// indefinitely with no way to know it had actually died. Generous because
// legitimate local inference on this hardware can genuinely take minutes —
// widened from 5 to 10 once a real app's Object Library grew past ~100
// entries (every object is listed in the generation prompt), which reliably
// pushed this CPU-only 3B model's inference time past the old ceiling.
const GENERATE_TIMEOUT_MS = 10 * 60 * 1000;

// Node's built-in fetch (undici) enforces its OWN default headersTimeout/
// bodyTimeout of 5 minutes — entirely separate from any AbortSignal passed
// to fetch() itself. Confirmed in practice: raising GENERATE_TIMEOUT_MS
// above did nothing — every long call still died at ~5 minutes with a
// generic "fetch failed" (not the custom TimeoutError message below),
// because undici's own ceiling fired first every time. This has to be
// raised on the global dispatcher, since fetch() has no per-call option for
// it. Other calls (e.g. healthCheck's 3s AbortSignal) are unaffected — they
// still resolve/abort well within this larger ceiling.
setGlobalDispatcher(new Agent({ headersTimeout: GENERATE_TIMEOUT_MS, bodyTimeout: GENERATE_TIMEOUT_MS }));

/** Shared base for local providers (Ollama, llama.cpp) that both speak an OpenAI-compatible HTTP surface. */
export abstract class OpenAiCompatibleHttpProvider implements AiProvider {
  abstract readonly name: string;
  protected abstract baseUrl: string;
  protected abstract model: string;

  async generateText(prompt: string, options?: AiGenerateOptions): Promise<AiCompletion> {
    const messages = [
      ...(options?.system ? [{ role: 'system', content: options.system }] : []),
      { role: 'user', content: prompt },
    ];
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.model,
          messages,
          temperature: options?.temperature ?? 0.2,
          max_tokens: 4096,
          // Ollama-specific extension (ignored by strict OpenAI-compatible servers):
          // small local models default to a short context window that truncates
          // longer structured JSON responses mid-object without this.
          options: { num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
      });
    } catch (err) {
      if ((err as Error).name === 'TimeoutError') {
        throw new Error(`${this.name} request timed out after ${GENERATE_TIMEOUT_MS / 1000}s`);
      }
      throw err;
    }
    if (!res.ok) {
      throw new Error(`${this.name} request failed: ${res.status} ${await res.text()}`);
    }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    return { content, raw: data };
  }

  // Small local CPU models (confirmed here with a 3B Ollama model) sometimes
  // respond with prose, an empty string, or a truncated fragment instead of
  // the requested JSON despite the system prompt — a genuine, observed ~50%
  // failure rate on identical prompts across this engagement (2/2 successes
  // vs. 2/2 failures for the same flow-generation call), not a parsing bug:
  // the extraction in parseJsonLoose already handles markdown fences and
  // does balanced-brace matching. Retrying the same request is cheap relative
  // to how expensive a single call already is (minutes) and, since failures
  // aren't correlated between attempts, reliably converts that ~50% failure
  // rate into a small single-digit one instead of surfacing it to the user.
  private static readonly JSON_RETRY_ATTEMPTS = 3;

  async generateJson<T = unknown>(prompt: string, options?: AiGenerateOptions): Promise<T> {
    const jsonOptions = {
      ...options,
      system: `${options?.system ?? ''}\nRespond with valid JSON only, no markdown fences, no prose.`.trim(),
    };
    let lastError: Error | undefined;
    for (let attempt = 1; attempt <= OpenAiCompatibleHttpProvider.JSON_RETRY_ATTEMPTS; attempt++) {
      const completion = await this.generateText(prompt, jsonOptions);
      try {
        return parseJsonLoose<T>(completion.content);
      } catch (err) {
        lastError = err as Error;
        logger.warn(
          `${this.name} returned non-JSON output on attempt ${attempt}/${OpenAiCompatibleHttpProvider.JSON_RETRY_ATTEMPTS}` +
            (attempt < OpenAiCompatibleHttpProvider.JSON_RETRY_ATTEMPTS ? ' — retrying.' : ' — giving up.'),
        );
      }
    }
    throw lastError;
  }

  abstract generateEmbedding(text: string): Promise<number[]>;

  async *streamText(prompt: string, options?: AiGenerateOptions): AsyncIterable<string> {
    const completion = await this.generateText(prompt, options);
    yield completion.content;
  }

  async healthCheck(): Promise<{ healthy: boolean; detail?: string }> {
    try {
      const res = await fetch(`${this.baseUrl}/models`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        return { healthy: false, detail: `HTTP ${res.status}` };
      }
      return { healthy: true };
    } catch (err) {
      return { healthy: false, detail: (err as Error).message };
    }
  }
}
