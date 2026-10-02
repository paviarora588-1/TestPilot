'use client';

import { useEffect, useState } from 'react';

// Renders nothing until mounted so the server-rendered markup and the first
// client paint match (the time is inherently different on each) — avoids a
// hydration warning rather than suppressing it.
export function LiveClock() {
  const [time, setTime] = useState('');

  useEffect(() => {
    function tick() {
      setTime(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  if (!time) return null;

  return <span className="hidden shrink-0 font-mono text-xs text-muted-foreground lg:inline">{time}</span>;
}
