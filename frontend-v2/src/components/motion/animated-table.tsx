'use client';

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { staggerContainerVariants, staggerItemVariants } from './stagger';

const ROW_BASE_CLASSES =
  'border-b border-border/70 transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted';

// TableBody/TableRow (components/ui/table.tsx) render plain <tbody>/<tr> —
// StaggerContainer/StaggerItem can't wrap them (a <div> isn't valid inside
// <table>), so this pair applies the same variants directly to motion.tbody/
// motion.tr with each component's own current classes copied verbatim.
// Keeps every table's entrance animation consistent without re-deriving the
// class strings at each call site (first done by hand on the Applications
// page; extracted here once a second/third page needed the same pattern).
export function AnimatedTableBody({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <motion.tbody
      initial="hidden"
      animate="show"
      variants={staggerContainerVariants}
      className={className ?? '[&_tr:last-child]:border-0'}
    >
      {children}
    </motion.tbody>
  );
}

export function AnimatedTableRow({
  children,
  className,
  onClick,
  ...rest
}: {
  children: ReactNode;
  className?: string;
  onClick?: () => void;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <motion.tr variants={staggerItemVariants} onClick={onClick} className={cn(ROW_BASE_CLASSES, className)} {...rest}>
      {children}
    </motion.tr>
  );
}
