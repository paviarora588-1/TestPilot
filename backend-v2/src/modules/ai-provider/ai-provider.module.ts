import { Module, Provider } from '@nestjs/common';
import { AiProviderController } from './ai-provider.controller';
import { AI_PROVIDER_TOKEN } from './ai-provider.tokens';
import { LlamaCppProvider } from './providers/llamacpp.provider';
import { OllamaProvider } from './providers/ollama.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { GroqProvider } from './providers/groq.provider';

/** Mirrors the legacy app's ai/factory.py dispatch pattern (openai | local/llama_cpp/llamacpp | ollama | groq). */
const aiProviderFactory: Provider = {
  provide: AI_PROVIDER_TOKEN,
  useFactory: () => {
    const providerName = (process.env.AI_PROVIDER ?? 'ollama').trim().toLowerCase();
    switch (providerName) {
      case 'openai':
        return new OpenAiProvider();
      case 'groq':
        return new GroqProvider();
      case 'local':
      case 'llama_cpp':
      case 'llamacpp':
        return new LlamaCppProvider();
      case 'ollama':
        return new OllamaProvider();
      default:
        throw new Error(`Unsupported AI_PROVIDER: ${providerName}`);
    }
  },
};

@Module({
  controllers: [AiProviderController],
  providers: [aiProviderFactory],
  exports: [AI_PROVIDER_TOKEN],
})
export class AiProviderModule {}
