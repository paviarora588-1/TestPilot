import type { Status } from '../types';

const toneMap: Record<string, string> = {
  Active:          'bg-green-500/15 text-green-300',
  Ready:           'bg-green-500/15 text-green-300',
  Passed:          'bg-green-500/15 text-green-300',
  Success:         'bg-green-500/15 text-green-300',
  processed:       'bg-green-500/15 text-green-300',
  uploaded:        'bg-blue-500/15 text-blue-300',
  Approved:        'bg-green-500/15 text-green-300',
  Review:          'bg-amber-500/15 text-amber-300',
  'Need Review':   'bg-amber-500/15 text-amber-300',
  Running:         'bg-blue-500/15 text-blue-300',
  Blocked:         'bg-red-500/15 text-red-400',
  Failed:          'bg-red-500/15 text-red-400',
  failed:          'bg-red-500/15 text-red-400',
  'Pending Review': 'bg-amber-500/15 text-amber-300',
  Manual:          'bg-white/[0.08] text-white/55',
  Analyzed:        'bg-purple-500/15 text-purple-300',
  mapped:          'bg-green-500/15 text-green-300',
  needs_review:    'bg-amber-500/15 text-amber-300',
  unmapped:        'bg-red-500/15 text-red-400',
};

export function Badge({ children }: { children: Status | string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${toneMap[String(children)] || 'bg-white/[0.08] text-white/55'}`}>
      {children}
    </span>
  );
}

export function Confidence({ value }: { value: number }) {
  const safeValue = Number.isFinite(value) ? value : null;
  const tone =
    safeValue === null ? 'bg-white/[0.08] text-white/55' :
    safeValue >= 90 ? 'bg-green-500/15 text-green-300' :
    safeValue >= 80 ? 'bg-blue-500/15 text-blue-300' :
    safeValue >= 70 ? 'bg-amber-500/15 text-amber-300' :
                  'bg-red-500/15 text-red-400';
  return <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${tone}`}>{safeValue === null ? '—' : `${safeValue}%`}</span>;
}
