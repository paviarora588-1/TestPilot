import type { ReactNode } from 'react';

export function DataTable({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr>{headers.map((header) => <th key={header} className="border-b border-line bg-slate-500/10 px-3 py-3 text-xs font-extrabold uppercase tracking-wide text-muted">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="transition hover:bg-slate-500/10">
              {row.map((cell, cellIndex) => <td key={cellIndex} className="border-b border-line px-3 py-3 align-top">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
