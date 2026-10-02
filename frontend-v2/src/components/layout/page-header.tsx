'use client';

import type { LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';

const EASE = [0.16, 1, 0.3, 1] as const;

export function PageHeader({
  title,
  description,
  icon: Icon,
  actions,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  actions?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE }}
      className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-border pb-5"
    >
      <div className="flex items-start gap-4">
        {Icon ? (
          <div className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent">
            <Icon className="h-5 w-5 text-accent-foreground" />
          </div>
        ) : null}
        <div>
          <h1 className="text-[1.6rem] leading-tight sm:text-[1.8rem]">{title}</h1>
          {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </motion.div>
  );
}
