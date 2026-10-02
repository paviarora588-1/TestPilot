import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';
import { PDFParse } from 'pdf-parse';
import type { KnowledgeFileType } from '../../../generated/prisma/enums';

export interface ParsedKnowledgeFile {
  text: string;
  fileType: KnowledgeFileType;
}

function extFromName(fileName: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(fileName);
  return match ? match[1].toLowerCase() : '';
}

async function extractXlsxText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  const lines: string[] = [];
  workbook.worksheets.forEach((sheet) => {
    sheet.eachRow((row) => {
      const cells = (row.values as unknown[]).slice(1).map((v) => (v == null ? '' : String(v)));
      if (cells.some((c) => c.trim())) lines.push(cells.join(' | '));
    });
  });
  return lines.join('\n');
}

function extractCsvText(buffer: Buffer): string {
  const records = parse(buffer, { skip_empty_lines: true, trim: true }) as string[][];
  return records.map((row) => row.join(' | ')).join('\n');
}

export async function parseKnowledgeFile(buffer: Buffer, fileName: string): Promise<ParsedKnowledgeFile> {
  const ext = extFromName(fileName);

  switch (ext) {
    case 'pdf': {
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText();
      return { text: result.text, fileType: 'PDF' };
    }
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer });
      return { text: result.value, fileType: 'DOCX' };
    }
    case 'xlsx':
      return { text: await extractXlsxText(buffer), fileType: 'XLSX' };
    case 'csv':
      return { text: extractCsvText(buffer), fileType: 'CSV' };
    case 'md':
    case 'markdown':
      return { text: buffer.toString('utf-8'), fileType: 'MARKDOWN' };
    default:
      return { text: buffer.toString('utf-8'), fileType: 'TEXT' };
  }
}
