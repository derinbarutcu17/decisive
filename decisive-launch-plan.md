# Decisive launch page — approved plan

Source: approved in the Open Design creative-director session, 2026-09-11.
Execution: built here directly (Open Design was locked in read-only plan mode).

## Locked decisions

| Item | Decision |
|---|---|
| Release | Publish `v1.0.0` before launch; site links `releases/latest` (parked until asked) |
| Specs | macOS 12+ · Apple silicon only |
| Version string | "Decisive for macOS — Version 1.0.0" in the download section; no version in hero or nav |
| Video | Inline optimized 720p clip (target ≤ 8MB) instead of the 35.6MB original |
| Attribution | "Made by Derin Barutcu" + MIT license link |
| Routing | Launch site at the domain root, web demo under `/app` (flagged, out of scope for this build) |
| Scope | Build + local preview only. No deploy, no publishing |

## Brand tokens (extracted from the real app)

| Token | Value | Role |
|---|---|---|
| Screen | `#0b0b0b` | Dark chapters |
| Surface | `#141414` / `#1a1a19` | Cards, frames |
| Ink | `#f2f1ed` | Primary text on dark |
| Muted | `#92928b` | Secondary text |
| Lines | `#353532` / `#53534e` | Hairlines |
| Accent | `#ff5908` | The one chromatic action color |
| Quadrants | Do `#6ea8fe` · Schedule `#55d6be` · Delegate `#f4b942` · Eliminate `#ff6b6b` · Done `#70d394` | Semantic only |
| Type | Inter Variable, self-hosted (OFL) | Display, body, UI |

## Creative brief

- **Audience**: people who want a fast, private, offline workspace for sorting
  what actually matters. Indie devs, makers, productivity-tool evaluators.
- **Goal**: one action, download the Mac app. Everything else supports it.
- **Brand feel**: machined, calm, private. Apple launch-page discipline
  (chapter rhythm, restrained chrome, one CTA) wearing Decisive's own
  black / chrome / orange identity, not Apple blue.
- **Anti-patterns**: no fabricated metrics or testimonials, no stock
  photography (real UI only), no purple gradients, no emoji icons, no second
  orange CTA in any viewport, no hand-drawn illustrations.

## Direction

Apple's structural grammar (binary dark ↔ light chapters, capsule CTAs,
generous chapter rhythm, tight display tracking) with Decisive tokens
overriding the palette. Dark dominant. One flourish: the four chrome
quadrant tiles as an interactive method moment. Motion uses
`cubic-bezier(0.28, 0, 0.22, 1)`, IntersectionObserver reveals, quad-tile
sheen on hover, a dot texture behind the hero, all disabled under
`prefers-reduced-motion`.

## Page plan (single page, `decisive-launch.html`)

| # | Section | Goal | Content and media |
|---|---|---|---|
| 0 | Nav (dark, translucent) | Orientation | Mark + wordmark; Overview · Method · Download; GitHub text link; small secondary download capsule |
| 1 | Hero (black) | Position in one screen | Eyebrow `LOCAL-FIRST · FOR MACOS`; H1 "A local-first decision matrix for the work that matters."; sub from README; primary CTA "Download for macOS" + text link "Try it in your browser"; `decisive-desktop.png` in a rounded window frame; micro row "No account · No cloud · Your data stays on your Mac" |
| 2 | Method (light) | Teach the 2x2 in 10 seconds | "The method, made obvious." Four chrome tiles: Do / Schedule / Delegate / Eliminate with their colors; hover lift and sheen |
| 3 | Tagline reveal (black) | Statement moment | "Capture the task. Keep the next move visible." Words activate one at a time on scroll |
| 4 | Capture (dark) | Prove speed | "Type once. Press Enter." Recreated capture bar with the mono `Enter → Do` chip |
| 5 | Scatter (dark) | Differentiate from lists | "A map, not a list." Scatter on Importance x Urgency; drag-between-quadrants copy |
| 6 | Archive (dark) | Close the loop | Done archive, one-step undo, two-step delete. One short block |
| 7 | Yours alone (light) | Trust | Local JSON file, offline, menu bar presence, motion that pauses when unfocused; iPhone screenshot |
| 8 | Demo (black) | Show, don't tell | Poster + click-to-play inline 720p video |
| 9 | Download (black) | Convert | Large chrome mark; "Decisive for macOS — Version 1.0.0"; the one repeat primary CTA; spec list; honest unsigned-build "Open Anyway" helper |
| 10 | Footer | Close | Mark, "Made by Derin Barutcu", GitHub / Web preview / Releases / License |

## Execution checklist

1. Save this plan (done)
2. Copy and optimize assets into `assets/`: screenshots, mark, favicon,
   Inter TTF, 720p demo clip
3. Build `decisive-launch.html`
4. Preview on localhost, visual QA at desktop and mobile widths
5. Pre-delivery check (console, contrast, reduced motion)

Parked until asked: commit and tag `v1.0.0`, publish the release, deploy or
routing changes.
