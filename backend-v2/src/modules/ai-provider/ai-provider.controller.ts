import { Controller, Get, Inject } from '@nestjs/common';
import { AI_PROVIDER_TOKEN } from './ai-provider.tokens';
import type { AiProvider } from './ai-provider.interface';
import { checkCodexHealth } from '../../common/codex-cli.util';

@Controller('health')
export class AiProviderController {
  constructor(@Inject(AI_PROVIDER_TOKEN) private readonly aiProvider: AiProvider) {}

  @Get('ai')
  async healthCheck() {
    const result = await this.aiProvider.healthCheck();
    return { provider: this.aiProvider.name, ...result };
  }

  @Get('codex')
  async codexHealthCheck() {
    const result = await checkCodexHealth();
    return { provider: 'Codex CLI', ...result };
  }
}
