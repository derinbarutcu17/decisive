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

- Matrix uses the three-column priority layout: Do remains tall, Schedule and Delegate stay paired, and Done/Eliminate yield space first.
- The native macOS window has a 1080×720 minimum so the three-column arrangement is never forced into an unreadable native size.
- Scatter occupies the main view column while the Done rail remains stable.
- The plot is capped by the available chart-shell height, never by `vh` alone.

### Compact desktop/tablet: 720px–1040px

- Matrix flattens into one explicit 2×2 grid: Do and Schedule form the first row; Delegate and Eliminate form the second; Done gets a short third row. The row minimums are 190px, 150px, and 108px respectively, with a 12px gap.
- Do, Schedule, and Delegate retain their task lists first; Eliminate and Done are the first surfaces to yield height.
- Every compact panel has `min-height: 0` and clips its own bounds; its `.cards` list owns overflow. A populated Eliminate list may shrink below its three-row preferred height and scroll internally rather than paint into Done.
- Original layout uses the same compact grid and containment rules so the layout toggle cannot create a nested-grid overlap.
- Scatter uses the full content width, hides the low-priority Done rail, and keeps its square plot inside a single non-scrolling Scatter row.
- Header actions remain independent of the centered brand.

### Phone: below 720px

- The brand is centered on its own row.
- Header controls form a second row when needed.
- Matrix quadrants and Done are single-column panels.
- Each panel owns a bounded task list; adding tasks scrolls inside the list instead of resizing the panel.

### Archive history

- Archive is a document-flow history view, not a bounded task viewport.
- The archive panel must grow with its entries; the page owns scrolling when the history is taller than the viewport.
- `.archive-cards-frame` and `.archive-cards` must keep `max-height: none`, `overflow: visible`, and must not use the task-list fade layer.
- The four Matrix quadrants and Done panel are the only bounded list surfaces. Never reuse their four-row cap for Archive.
- With `n` archived rows, the archive panel's content height must include the heading, all `n` rows, and the inter-row gaps; no row may be hidden behind an overlay or clipped at the panel midpoint.
- Archive rows fill the archive panel's content width; they must not shrink to the width of the longest row.

### View selection

- The active Matrix, Scatter, or Archive control is indicated by text weight and color.
- Do not add a second outline around the active control; the view switcher's outer boundary is the only control-group boundary.

### iPhone preview

The 402px shell is an intentional device frame with a Dynamic Island. Its outer frame may exceed the CSS viewport by a small, documented amount; the app content inside it must remain aligned to the shell’s safe content width.

## Scatter labels and interaction layering

- Dots are one filled point; no grid marker circles are added.
- Labels are hidden by default and appear for hover, focus, and drag.
- The Settings panel may enable “Show task names in Scatter.” Each visible label stays attached to its own dot using a nearby anchor; labels avoid collisions only inside the local collision-connected neighborhood.
- Labels are clamped to the plot bounds and use truncation for inactive long titles; they never change the plot’s dimensions or trigger page reflow.
- The interacted dot gets `.is-frontmost` and a higher stacking layer. Its label is always above neighboring labels and retains the full task title while active.
- When a task crosses a quadrant boundary, the dot color follows the destination quadrant immediately.
- During drag or keyboard movement, every label remains parented to its own dot. Labels never move to a distant collision-avoidance rail; anchors and small nudges are the only allowed corrections.
- A moving label gets priority. Only labels whose current rectangles form a local collision-connected component may react, capped at eight labels and four collision hops. Unconnected labels retain their logical target exactly.
- Labels must stay within 4px of another label's clearance when space permits, but controlled overlap is allowed when every nearby anchor would violate the plot bounds or the attachment limit.
- A label may nudge no more than 12px from an anchor. Anchor changes use a 20% improvement threshold and a 120ms lock to prevent rapid side flipping; a collision must persist for roughly 100ms before an inactive label yields its anchor.
- Label targets are logical transform offsets, not live in-flight DOM rectangles. Each frame commits only the latest target and uses an eased transform so the dot and its local label cluster remain trackable without jitter.

## Verification contract

Run `node test/layout-audit.cjs` through Electron against an isolated fixture server. Required states:

- 1440×960 Matrix
- 1440×960 Scatter
- 1440×960 Archive
- 920×720 Matrix
- 920×720 Scatter
- 920×720 Archive
- 390×844 iPhone Matrix
- 390×844 iPhone Scatter
- 390×844 iPhone Archive

Pass criteria:

- brand center delta ≤ 1px;
- plot width/height delta ≤ 1px;
- Scatter plot is fully contained by `#scatter-view`;
- All five Matrix panels (Do, Schedule, Delegate, Eliminate, Done) stay contained by `#layout` and do not overlap;
- Archive is standalone: Matrix, Scatter, and Done are hidden in Archive mode;
- Archive history is not internally capped or scroll-clipped: the archive list's rendered bottom is reachable in normal page flow;
- header actions do not overlap the brand;
- visible Scatter labels do not overlap one another when space permits;
- the active label is frontmost;
- live task data is not used as a test fixture and is never mutated by layout checks.
