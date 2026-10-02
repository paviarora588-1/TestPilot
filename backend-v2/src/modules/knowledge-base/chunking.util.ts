// Fixed-size character chunking with overlap — simple and good enough for
// local embedding models; no tokenizer dependency needed for this scale.
const CHUNK_SIZE = 1800;
const OVERLAP = 200;

export function chunkText(text: string, chunkSize = CHUNK_SIZE, overlap = OVERLAP): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const chunks: string[] = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + chunkSize, normalized.length);
    const chunk = normalized.slice(start, end).trim();
    if (chunk) chunks.push(chunk);
    if (end === normalized.length) break;
    start = end - overlap;
  }
  return chunks;
}
