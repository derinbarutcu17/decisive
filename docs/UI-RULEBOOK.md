# Decisive UI rulebook

This is the layout contract for the Matrix and Scatter views. It turns the visual system into measured rules so responsive states stay aligned as the window grows, contracts, or switches views.

## Spacing scale

Use a 4px base rhythm. Prefer the named CSS variables in `style.css` over new one-off values.

| Token | Value | Use |
| --- | ---: | --- |
| `--space-1` | 4px | icon/text micro-gap |
| `--space-2` | 8px | control internals and compact gaps |
| `--space-3` | 12px | adjacent controls and card gaps |
| `--space-4` | 16px | panel internals |
| `--space-5` | 24px | section separation |
| `--space-6` | 32px | major separation |
| `--space-7` | 44px | desktop outer padding |

The 15px compact panel inset, 18px Matrix gap, and 34px Scatter axis rail are deliberate geometry exceptions. Do not introduce additional values without documenting why they cannot use the scale.

## Alignment anchors

1. The `.app-identity` row is centered against the full `#console` content box.
2. `.app-brand` is one centered lockup: the mark and name share the same vertical center and an 8px gap. It never becomes left-aligned at a responsive breakpoint.
3. Header actions are independently positioned and must not move the brand’s center.
4. The capture rail, layout frame, and primary panels share the same inline edges.
5. Matrix tracks are equal width and equal height within their available grid.
6. Scatter’s plot is square and centered inside its chart shell. Its axes align to the plot, not to the outer page.
7. Count pills are anchored to the quadrant’s top-right inset and never participate in heading flow.

## Responsive states

### Desktop: wider than 1040px

- `#layout` is a two-column grid: Done rail plus the main view column.
- Matrix is a 2×2 equal-track grid.
- Scatter occupies the main view column while the Done rail remains stable.
- The plot is capped by the available chart-shell height, never by `vh` alone.

### Compact desktop/tablet: 720px–1040px

- The layout becomes one column.
- Matrix stacks into one column and Done follows it.
- Scatter uses the full content width; its square plot stays inside the Scatter row.
- Header actions remain independent of the centered brand.

### Phone: below 720px

- The brand is centered on its own row.
- Header controls form a second row when needed.
- Matrix quadrants and Done are single-column panels.
- Each panel owns a bounded task list; adding tasks scrolls inside the list instead of resizing the panel.

### iPhone preview

The 402px shell is an intentional device frame with a Dynamic Island. Its outer frame may exceed the CSS viewport by a small, documented amount; the app content inside it must remain aligned to the shell’s safe content width.

## Scatter labels and interaction layering

- Dots are one filled point; no grid marker circles are added.
- Labels are hidden by default and appear for hover, focus, and drag.
- “Show names” may reveal all labels, but each visible label is measured and assigned a collision-aware placement from the six available anchors.
- Labels are clamped to the plot bounds and use truncation for inactive long titles; they never change the plot’s dimensions or trigger page reflow.
- The interacted dot gets `.is-frontmost` and a higher stacking layer. Its label is always above neighboring labels and retains the full task title while active.
- When a task crosses a quadrant boundary, the dot color follows the destination quadrant immediately.

## Verification contract

Run `node test/layout-audit.cjs` through Electron against an isolated fixture server. Required states:

- 1440×960 Matrix
- 1440×960 Scatter
- 920×720 Matrix
- 920×720 Scatter
- 390×844 iPhone Matrix
- 390×844 iPhone Scatter

Pass criteria:

- brand center delta ≤ 1px;
- plot width/height delta ≤ 1px;
- Scatter plot is fully contained by `#scatter-view`;
- Matrix quadrants do not overlap;
- header actions do not overlap the brand;
- visible Scatter labels do not overlap one another when space permits;
- the active label is frontmost;
- live task data is not used as a test fixture and is never mutated by layout checks.
