function extractFirstJsonValue(text: string): string {
  const braceIndex = text.indexOf('{');
  const bracketIndex = text.indexOf('[');
  const candidates = [braceIndex, bracketIndex].filter((i) => i !== -1);
  if (candidates.length === 0) {
    throw new Error('No JSON object found in AI response');
  }
  const begin = Math.min(...candidates);
  const openChar = text[begin];
  const closeChar = openChar === '{' ? '}' : ']';

  let depth = 0;
  let inString = false;
  let escapeNext = false;
  for (let i = begin; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (char === '\\') {
        escapeNext = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === openChar) depth++;
    else if (char === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(begin, i + 1);
      }
    }
  }
  throw new Error('Unbalanced JSON in AI response');
}

/** Small local models often wrap JSON in markdown fences or add prose; parse defensively. */
export function parseJsonLoose<T = unknown>(text: string): T {
  const cleaned = text
    .trim()
    .replace(/^```(json)?/i, '')
    .replace(/```$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return JSON.parse(extractFirstJsonValue(cleaned)) as T;
  }
}
