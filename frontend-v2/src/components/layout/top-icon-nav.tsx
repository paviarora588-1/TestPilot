'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { NAV_ITEMS } from '@/lib/nav-config';

export function TopIconNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className="flex items-center justify-between gap-0.5 overflow-x-auto px-2 py-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {NAV_ITEMS.map((item, index) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const showDivider = item.group !== undefined && item.group !== NAV_ITEMS[index - 1]?.group;

        return (
          <div key={item.href} className="flex shrink-0 items-center">
            {showDivider ? <div className="mx-1 h-8 w-px shrink-0 bg-border" /> : null}
            <Link
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex shrink-0 flex-col items-center gap-1 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-[10px] font-medium transition-colors',
                isActive ? 'text-primary-foreground' : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {isActive ? (
                <motion.div
                  layoutId="top-icon-nav-active-pill"
                  className="absolute inset-0 rounded-lg bg-primary dark:shadow-[0_0_16px_-2px_var(--primary)] dark:ring-1 dark:ring-primary/40"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              ) : null}
              <Icon className="relative z-10 h-4 w-4 shrink-0" />
              <span className="relative z-10">{item.label}</span>
            </Link>
          </div>
        );
      })}
    </nav>
  );
}
