# TestPilot Design System

Single source of truth for TestPilot's visual language. Tokens live in `src/app/globals.css`; this document explains the *why* and gives the vocabulary the team uses to talk about it.

## What TestPilot is

An AI-driven QA automation platform: scan an application (web or SAP GUI), let AI turn what it finds into test cases, test data, and automation flows, compile those into real Playwright/Selenium/VBScript, execute them, and self-heal when a locator breaks. The people using it are QA engineers and automation leads — technical, comfortable with dense information, unimpressed by decoration that doesn't do anything.

## The signature element: **the Instrumentation HUD**

One idea, used everywhere: TestPilot's UI reads like the cockpit of the thing it operates — a diagnostic instrument panel, not a form-filling app. Concretely, three recurring devices carry this:

1. **Corner brackets** (`components/ui/corner-brackets.tsx`) — a targeting-reticle accent on every panel in dark mode. Says "this is a monitored surface," not "this is a rounded rectangle."
2. **Cyan as the only accent** — one signal color, used for state (active nav, primary actions, focus, live status), never decoration. Everything else is near-black void or muted gray. Restraint is what makes the cyan mean something.
3. **Live telemetry language** — mono/tracked-uppercase labels ("SYSTEM ONLINE", "CURRENT APPLICATION"), animated count-up numbers, a blinking status dot. Numbers arrive like readings, not like static labels.

Semantic color (success/warning/danger — emerald/amber/rose) is separate from this accent and never competes with it. New screens should ask "does this look like an instrument reading a system, or a form asking for input" and lean toward the former wherever the content allows it.

## Color

Defined in `globals.css` as OKLCH tokens, light and dark. **Dark is the primary, designed-for experience** — light exists and must not break, but every deliberate choice below is made for dark first.

| Token | Dark value | Role |
|---|---|---|
| `--background` | `oklch(0.1 0.012 235)` | Near-black blue-tinted void |
| `--card` | `oklch(0.14 0.016 235)` | Elevated surface |
| `--primary` | `oklch(0.8 0.13 205)` | The one accent — bright cyan |
| `--border` | `oklch(0.8 0.06 205 / 14%)` | Translucent cyan hairline |
| `--muted-foreground` | `oklch(0.64 0.02 220)` | Secondary text |
| `--destructive` | `oklch(0.704 0.191 22.216)` | Danger only |

Semantic extras (Badge variants, StatCard accents): `success`/`emerald`, `warning`/`amber`, `info`/`sky`, plus `violet`/`rose` for stat differentiation. These are for *meaning*, not for filling space — a screen with five different accent colors on non-semantic elements has lost the plot.

## Typography

Three faces, three jobs:
- **Display/headings** — **Chakra Petch** (`--font-heading`), geometric and technical. Applied automatically to every `h1`-`h6` via a base-layer rule — no page opts in manually.
- **Body** — **Geist Sans** (`--font-sans`). Clean, neutral, does not compete with headings.
- **Data/labels/code** — **Geist Mono** (`--font-mono`). Used for tracked-uppercase labels, table headers, code, anything that reads as a "reading" rather than prose.

Scale: stick to Tailwind's default type scale (`text-xs` through `text-3xl`) rather than inventing new sizes — the discipline is in *reusing* the scale consistently, not adding to it.

## Spacing & radius

One radius scale, derived from a single base (`--radius: 0.6rem`) via `--radius-sm` (×0.6) through `--radius-4xl` (×2.6) — never an arbitrary radius value in a component. Corner brackets substitute for heavier shadow-based elevation on dark panels; where a real shadow is needed, layer a soft `shadow-[0_0_Npx_-Mpx_color]` glow rather than a hard drop shadow (see Button's `dark:shadow-[0_0_16px_-6px_var(--primary)]`).

## Motion

`motion` (Framer Motion's current package name) — already installed, already the whole animation layer. Reusable primitives live in `src/components/motion/`:

| Primitive | Use |
|---|---|
| `fade-in.tsx` | Single-element entrance |
| `stagger.tsx` (`StaggerContainer`/`StaggerItem`, or raw variants for non-`div` tags like table rows) | Orchestrated list/grid entrance, 70ms stagger |
| `count-up.tsx` | Any number that represents live/fetched data — never a static digit for something that changes |
| `tilt-card.tsx` | Interactive module tiles (subtle pointer-tilt) |
| `hud-background.tsx` | Ambient animated backdrop, dark mode only |

Principles: orchestrate one entrance sequence per screen (stagger), not per-element scattered effects. Springs over linear eases for anything interactive. Respect `prefers-reduced-motion` — verify each new motion use against it, the same way every existing primitive already does.

## Component states

Every interactive component must define: default, hover, focus-visible (real ring, not just an outline removal), disabled, loading. `Button`/`Badge`/`Card`/`Table` already do this — new components should read those first rather than starting from a blank shadcn primitive.

## Working rule for this redesign

Presentation and motion only. Never touch data-fetching, mutations, or business logic while restyling a page — if a page's visual debt seems to require a logic change, stop and flag it rather than quietly changing behavior.
