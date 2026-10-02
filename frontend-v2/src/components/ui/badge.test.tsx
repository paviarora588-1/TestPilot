import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { Badge } from './badge';

describe('Badge', () => {
  it('renders its children as text content', () => {
    render(<Badge>PASS</Badge>);
    expect(screen.getByText('PASS')).toBeInTheDocument();
  });

  it('applies the variant-specific class so status colors actually differ', () => {
    render(<Badge variant="success">passed</Badge>);
    const badge = screen.getByText('passed');
    expect(badge.className).toContain('emerald');
  });

  it('applies the destructive variant class for a failing status', () => {
    render(<Badge variant="destructive">failed</Badge>);
    const badge = screen.getByText('failed');
    expect(badge.className).toContain('destructive');
  });

  it('falls back to the default variant when none is passed', () => {
    render(<Badge>default</Badge>);
    const badge = screen.getByText('default');
    expect(badge.className).toContain('bg-primary');
  });
});
