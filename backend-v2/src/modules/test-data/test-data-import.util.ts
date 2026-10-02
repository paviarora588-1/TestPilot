import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface ParsedDataItem {
  key: string;
  value: string;
}

export function parseTestDataCsv(buffer: Buffer): ParsedDataItem[] {
  const records = parse(buffer, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
  return records
    .map((r) => ({ key: (r.key ?? '').trim(), value: r.value ?? '' }))
    .filter((r) => r.key.length > 0);
}

export async function parseTestDataExcel(buffer: Buffer): Promise<ParsedDataItem[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const items: ParsedDataItem[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const key = String(row.getCell(1).value ?? '').trim();
    const value = String(row.getCell(2).value ?? '');
    if (key) items.push({ key, value });
  });
  return items;
}

export function parseTestDataJson(buffer: Buffer): ParsedDataItem[] {
  const parsed = JSON.parse(buffer.toString('utf-8'));
  if (Array.isArray(parsed)) {
    return parsed
      .map((entry) => ({ key: String(entry.key ?? '').trim(), value: String(entry.value ?? '') }))
      .filter((r) => r.key.length > 0);
  }
  return Object.entries(parsed).map(([key, value]) => ({ key, value: String(value) }));
}
