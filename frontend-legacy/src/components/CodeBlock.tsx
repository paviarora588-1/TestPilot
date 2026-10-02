export function CodeBlock({ code }: { code: string }) {
  return <pre className="min-h-80 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-5 text-sm leading-6 text-blue-100 shadow-soft"><code>{code}</code></pre>;
}
