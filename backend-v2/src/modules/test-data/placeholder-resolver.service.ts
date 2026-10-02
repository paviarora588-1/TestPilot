import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

const PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z]+)(?::(\d+))?\s*\}\}/g;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class PlaceholderResolverService {
  /** Resolves inline tokens like "Automation{{timestamp}}" or "{{randomEmail}}". */
  resolve(value: string): string {
    return value.replace(PLACEHOLDER_PATTERN, (_match, token: string, param?: string) => {
      switch (token.toLowerCase()) {
        case 'timestamp':
          return String(Date.now());
        case 'randomemail':
          return `user${randomInt(100000, 999999)}@example.com`;
        case 'randomuser':
          return `user${randomInt(100000, 999999)}`;
        case 'today':
          return isoDate(new Date());
        case 'futuredate': {
          const days = param ? parseInt(param, 10) : 7;
          const future = new Date();
          future.setDate(future.getDate() + days);
          return isoDate(future);
        }
        default:
          return _match;
      }
    });
  }

  listSupportedTokens() {
    return ['{{timestamp}}', '{{randomEmail}}', '{{randomUser}}', '{{today}}', '{{futureDate}}', '{{futureDate:30}}'];
  }

  // Paired with a description so an AI prompt can pick the SEMANTICALLY right
  // token instead of just pattern-matching "this field needs something
  // unique" — e.g. assigning {{futureDate:30}} to a CAPTCHA field would
  // otherwise look like a plausible fit for "not a fixed literal" without
  // this context.
  describeSupportedTokens() {
    return [
      '{{timestamp}} — current epoch milliseconds; for any value that just needs to be unique per run',
      '{{randomEmail}} — a random-but-valid-looking email address',
      '{{randomUser}} — a random-but-valid-looking username',
      '{{today}} — today\'s date (YYYY-MM-DD)',
      '{{futureDate:N}} — a date N days from today (YYYY-MM-DD) — ONLY for fields that are genuinely calendar dates',
    ];
  }
}
