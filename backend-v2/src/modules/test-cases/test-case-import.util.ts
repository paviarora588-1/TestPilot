import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export interface ParsedTestCaseRow {
  externalId?: string;
  title: string;
  moduleName?: string;
  featureName?: string;
  steps: string[];
  expectedResult?: string;
  priority?: string;
}

/**
 * Column contract matches the legacy app's docs/sample-testcases.csv:
 * test_case_id,title,module,feature,steps,expected_result,priority,source
 * `steps` is newline-separated within one field.
 */
function rowToTestCase(row: Record<string, string>): ParsedTestCaseRow | null {
  const title = (row.title ?? '').trim();
  if (!title) return null;
  const stepsRaw = row.steps ?? '';
  return {
    externalId: row.test_case_id?.trim() || undefined,
    title,
    moduleName: row.module?.trim() || undefined,
    featureName: row.feature?.trim() || undefined,
    steps: stepsRaw
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean),
    expectedResult: row.expected_result?.trim() || undefined,
    priority: row.priority?.trim() || undefined,
  };
}

export function parseTestCasesCsv(buffer: Buffer): ParsedTestCaseRow[] {
  const records = parse(buffer, { columns: true, skip_empty_lines: true, trim: false }) as Record<
    string,
    string
  >[];
  return records.map(rowToTestCase).filter((r): r is ParsedTestCaseRow => r !== null);
}

export async function parseTestCasesExcel(buffer: Buffer): Promise<ParsedTestCaseRow[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const headerRow = sheet.getRow(1);
  const headers: string[] = [];
  headerRow.eachCell((cell, colNumber) => {
    headers[colNumber] = String(cell.value ?? '').trim();
  });

  const rows: ParsedTestCaseRow[] = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const record: Record<string, string> = {};
    row.eachCell((cell, colNumber) => {
      const header = headers[colNumber];
      if (header) record[header] = String(cell.value ?? '');
    });
    const parsed = rowToTestCase(record);
    if (parsed) rows.push(parsed);
  });
  return rows;
}
