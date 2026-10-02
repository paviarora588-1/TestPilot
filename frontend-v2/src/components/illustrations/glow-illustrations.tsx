import { Brain, FileSearch2 } from 'lucide-react';
import { cn } from '@/lib/utils';

// Shared "glowing AI artifact" look used on AI-generation panels and empty
// states across the app — a lucide icon lit up with layered blur/ring glows
// instead of a flat monochrome icon, so these moments read as something the
// AI is actively doing, not a plain placeholder.

export function BrainOrbIllustration({ className }: { className?: string }) {
  return (
    <div className={cn('relative flex h-32 w-32 shrink-0 items-center justify-center', className)}>
      <div className="absolute inset-0 rounded-full bg-primary/25 blur-2xl" />
      <div className="absolute inset-1 rounded-full ring-1 ring-primary/25" />
      <div className="absolute inset-5 rounded-full ring-1 ring-primary/20" />
      <div className="absolute inset-8 rounded-full bg-gradient-to-br from-primary/40 to-primary/5 ring-1 ring-primary/50 shadow-[0_0_45px_-6px_var(--primary)]" />
      <Brain className="relative h-11 w-11 text-primary drop-shadow-[0_0_10px_var(--primary)]" strokeWidth={1.5} />
      <div className="absolute bottom-1 left-1/2 h-2.5 w-16 -translate-x-1/2 rounded-full bg-primary/50 blur-md" />
      <div className="absolute bottom-0 left-1/2 h-1 w-24 -translate-x-1/2 rounded-full bg-primary/30 blur-sm" />
    </div>
  );
}

export function SearchDocIllustration({ className }: { className?: string }) {
  return (
    <div className={cn('relative flex h-28 w-28 shrink-0 items-center justify-center', className)}>
      <div className="absolute inset-0 rounded-full bg-primary/10 blur-2xl" />
      <FileSearch2 className="relative h-16 w-16 text-primary/80 drop-shadow-[0_0_12px_var(--primary)]" strokeWidth={1.1} />
    </div>
  );
}
