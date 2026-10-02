'use client';

import { FormEvent, useState } from 'react';
import { Eye, EyeOff, Gauge, Rocket, ShieldCheck, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FadeIn } from '@/components/motion/fade-in';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { PipelineStrip } from '@/components/marketing/pipeline-strip';
import { useAuth } from '@/lib/auth-context';

const TRUST_BADGES = [
  { icon: ShieldCheck, label: '100% Local AI', description: 'Your data never leaves your environment.' },
  { icon: Gauge, label: 'Enterprise Ready', description: 'Secure, scalable, reliable.' },
  { icon: Rocket, label: 'Faster Releases', description: 'Ship high quality software with confidence.' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('admin@testpilot.local');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setIsSubmitting(true);
    try {
      await login(email, password);
    } catch {
      toast.error('Invalid email or password');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel — hidden below lg, where the form alone carries the page. */}
      <div className="relative hidden flex-col justify-between overflow-hidden border-r border-border bg-card p-10 lg:flex xl:p-14">
        <FadeIn>
          <span className="flex items-center gap-2 text-lg font-bold tracking-wide">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <Sparkles className="h-4 w-4" />
            </span>
            TestPilot
          </span>
        </FadeIn>

        <div className="flex flex-col gap-8">
          <FadeIn delay={0.05}>
            <p className="mb-3 text-xs font-semibold tracking-widest text-muted-foreground uppercase">
              AI-Assisted QA Automation
            </p>
            <h1 className="max-w-md text-3xl font-bold tracking-tight text-balance xl:text-4xl">
              Ship tested software, faster.
            </h1>
            <p className="mt-3 max-w-sm text-sm text-muted-foreground">
              Scan real applications, generate reviewed automation, and execute with confidence —
              all from one place.
            </p>
          </FadeIn>

          <FadeIn delay={0.15}>
            <PipelineStrip />
          </FadeIn>
        </div>

        <FadeIn delay={0.25}>
          <div className="grid grid-cols-3 gap-4 border-t border-border pt-6">
            {TRUST_BADGES.map((badge) => (
              <div key={badge.label} className="flex flex-col gap-1.5">
                <badge.icon className="h-4 w-4 text-accent-foreground" />
                <p className="text-xs font-semibold">{badge.label}</p>
                <p className="text-[11px] leading-snug text-muted-foreground">{badge.description}</p>
              </div>
            ))}
          </div>
        </FadeIn>
      </div>

      {/* Form panel */}
      <div className="relative flex flex-col items-center justify-center gap-8 p-6">
        <div className="absolute top-4 right-4">
          <ThemeToggle />
        </div>

        <span className="flex items-center gap-2 text-lg font-bold tracking-wide lg:hidden">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </span>
          TestPilot
        </span>

        <FadeIn className="w-full max-w-sm">
          <div className="mb-6 flex flex-col gap-1.5">
            <h2 className="text-2xl font-bold tracking-tight">Welcome back</h2>
            <p className="text-sm text-muted-foreground">Sign in to continue to your workspace.</p>
          </div>

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" disabled={isSubmitting} className="mt-2">
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </FadeIn>

        <p className="text-xs text-muted-foreground">Internal QA automation platform — access is by invitation only.</p>
      </div>
    </div>
  );
}
