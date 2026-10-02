'use client';

import { motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'motion/react';
import { type ReactNode, useRef } from 'react';

// A mouse-reactive 3D tilt + moving specular glare, the way a game inventory
// / holographic card reacts to the cursor — perspective tilt via spring
// physics (not a linear snap), plus a radial highlight that tracks the
// pointer so the surface reads as reflective, not flat.
export function TiltCard({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const rotateX = useSpring(useTransform(py, [0, 1], [10, -10]), { stiffness: 260, damping: 20 });
  const rotateY = useSpring(useTransform(px, [0, 1], [-10, 10]), { stiffness: 260, damping: 20 });
  const glareX = useTransform(px, (v) => `${v * 100}%`);
  const glareY = useTransform(py, (v) => `${v * 100}%`);
  const glareBackground = useTransform(
    [glareX, glareY] as unknown as MotionValue<string>[],
    ([gx, gy]: string[]) => `radial-gradient(circle at ${gx} ${gy}, rgba(103,232,249,0.18), transparent 55%)`,
  );

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    px.set((e.clientX - rect.left) / rect.width);
    py.set((e.clientY - rect.top) / rect.height);
  }
  function handleMouseLeave() {
    px.set(0.5);
    py.set(0.5);
  }

  return (
    <motion.div
      ref={ref}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{ rotateX, rotateY, transformPerspective: 900 }}
      className={className}
    >
      <motion.div className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ background: glareBackground }} />
      {children}
    </motion.div>
  );
}
