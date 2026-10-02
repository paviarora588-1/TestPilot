export function ProgressBar({ value }: { value: number }) {
  const color = value >= 85 ? 'bg-success' : value >= 70 ? 'bg-warning' : 'bg-error';
  return (
    <div className="flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/10">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${value}%` }} />
      </div>
      <strong className="text-sm">{value}%</strong>
    </div>
  );
}
