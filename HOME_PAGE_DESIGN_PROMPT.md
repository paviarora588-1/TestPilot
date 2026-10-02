# Design brief: TestPilot "Home" page

Paste this into another AI (ChatGPT, Gemini, v0.dev, Galileo AI, Midjourney, etc.) to get a design concept, then bring the result back here so it can be implemented in the real app.

## What TestPilot is

TestPilot is an **internal, enterprise AI QA automation platform** — not a consumer product, not a marketing site. QA engineers use it every day to scan applications, build an object library, generate test cases, build automation flows, generate real Playwright/Selenium code, run it, and review results. It already has a working dark/light theme, a top navigation bar, and a full set of functional screens (Dashboard, Applications, Scanner, Object Library, Test Cases, Test Data, Automation Builder, Script Generator, Executions, Reports, Jira/Zephyr integration, Settings).

## What this one page (`/home`) needs to do

This is the page a user lands on right after logging in — before they pick a specific screen to work in. It needs to, at minimum:

1. Greet the signed-in user and show which application they're currently working on (or a prompt to pick/create one).
2. Give one-click access into each of the 12 sections listed above (as a link/card/tile — whatever the design calls for).
3. Optionally: surface something genuinely useful at a glance (recent activity, an AI briefing, quick stats) — but only if it doesn't clutter the page.

## What's already been tried and rejected

- A calm, muted "premium enterprise SaaS" look (indigo/violet accents, subtle glassmorphism) — rejected as boring/generic.
- A loud neon "GTA VI" look (hot pink/orange/cyan gradients, huge uppercase gradient text, glowing multi-color tiles, grain texture) — also rejected.

Please don't propose a third variation of either of those two directions. Instead: **propose 2–3 genuinely different concepts** (different layout structures, not just different color palettes), briefly describe each one, and let the actual visual style be picked from real inspiration — a specific real product's dashboard/home screen you know of, described concretely enough to rebuild (e.g. "like Linear's home view: a single-column feed of cards, no hero section, dense but calm" or "like Vercel's dashboard: project grid as the very first thing, no greeting copy at all").

## Constraints for whatever comes back

- Built with Next.js + Tailwind CSS v4 + shadcn/ui (Base UI primitives) — describe the design in terms buildable with those (cards, grids, badges, icons), not raw Photoshop comps.
- Must work in both light and dark theme, unless the design is deliberately locked to one (state that explicitly if so).
- Responsive down to a single column on mobile.
- No invented data — whatever the design shows (stats, activity, etc.) has to come from real things TestPilot already tracks (application name, nav sections, user name).

## What to bring back

A written description (or image, or actual HTML/JSX if the tool can produce it) of each concept, precise enough to hand to a developer: layout structure, what's in the header vs. body, what's a card vs. a list vs. a grid, and the color/typography direction. Paste it back into this conversation.
