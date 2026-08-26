# Decisive interaction rulebook

Decisive is an operate-first task surface. Motion should explain a state change, preserve spatial context, and finish quickly. It should never make the Matrix, Done panel, or Archive history resize unpredictably.

## Motion budget

- Micro feedback: 120–180ms, ease-out.
- View or panel transitions: 220–320ms, `cubic-bezier(.22, 1, .36, 1)`.
- Drag-follow motion: frame-driven and interruptible; never queue stale positions.
- No decorative infinite motion in the foreground UI. The ASCII background remains an opt-in ambient layer.
- Every motion must have a `prefers-reduced-motion` fallback.

## Interaction inventory

| Surface | Small interaction | Rule | Status |
| --- | --- | --- | --- |
| Matrix / Scatter / Archive switcher | Active pill slides to the selected tab | Measure the active button; animate only pill `transform` and `width`; snap on first paint and resize | Implemented |
| Task capture field | Focus rail becomes clearer | Keep the neutral focus stroke; do not add glow or move the field | Implemented |
| Task capture submit | New task settles into Do | Clear the field, return focus to capture, and use one short settle cue on the inserted card | Implemented |
| Task card hover | Actions fade in at the trailing edge | Reveal the trash action without shifting title, checkbox, or card width | Implemented |
| Delete confirmation | Trash changes to cancel / approve | Fade the action pair in; use weight/color only on hover, with no scale or outline jump | Implemented |
| Task completion | Card moves between lists | Preserve the card’s content and use a short settle/fade cue after the server write succeeds | Implemented |
| Quadrant drag target | Destination becomes legible before drop | Use border/background emphasis only; keep the hit area equal to the whole quadrant, including its header | Implemented |
| Eliminate rail | Low-value work has a reversible destination | Keep Eliminate as a compact full-width rail; expand it only while populated or being targeted, show `Release to eliminate` during drag, and offer an inline Undo after the move | Implemented |
| Move to Eliminate action | Keyboard users can reach the same decision flow | Reveal a named card action on hover/focus; move the task into Eliminate without deleting it; keep permanent deletion behind the existing confirmation | Implemented |
| Quadrant task list | Bottom fade appears only when more content exists | Fade the pinned overlay with scroll state; never let it resize the quadrant or obscure the first row | Implemented |
| Task-card editing | Card expands to measured editor height | Animate the individual card from its current measured height to the editor height; never animate `height: auto`, the quadrant, or the page | Implemented |
| Settings popover | Panel opens from the gear and closes on outside click | Add a short opacity/translate transition while keeping focus and hit targets stable | Candidate |
| Settings switch | Toggle thumb tracks the state | Keep the existing switch geometry; use color and thumb translation only, with reduced-motion fallback | Implemented |
| Scatter dot drag | Dot follows the pointer smoothly | Use an interruptible frame loop; snap to the nearest grid point on release and update quadrant color immediately | Implemented |
| Scatter label reveal | Label fades in near its dot | Keep the label tethered to its dot, animate opacity/transform, and raise the active label above neighbors | Implemented |
| Scatter label collision response | Nearby labels yield locally | Reflow only the collision-connected neighborhood; cap nudge distance and preserve the prior anchor with hysteresis | Implemented |
| Archive navigation | Archive content enters as a document view | Use a subtle section fade only if it does not delay reading or change the page’s natural height | Candidate |
| Archive deletion | Row enters confirmation state | Reuse the task-card delete interaction; keep the archive row width and list rhythm fixed | Implemented |
| Done delete-all | Destructive action reveals explicit confirmation | Keep the action next to the Done count and require the same cancel / approve interaction as row deletion | Implemented |
| ASCII background setting | Ambient layer starts/stops cleanly | Toggle the canvas without affecting foreground layout; stop work when disabled | Implemented |

## Guardrails

- Do not apply resize transitions to `#layout`, `#matrix`, `.quadrant`, `.cards-frame`, or the Done panel. Their dimensions are layout-owned.
- Eliminate is the one deliberate exception: only its rail/card-frame state may transition between compact and expanded bounds; active quadrants and Done remain layout-stable.
- Do not use transforms that change the hitbox of controls or task cards.
- Do not animate text content, task labels, or counts in a way that delays scanning.
- Prefer CSS transitions for local state changes and a single `requestAnimationFrame` loop for pointer-following motion.
- Eliminate is reversible triage, not deletion: active quadrant → Eliminate rail → Archive → permanent delete.
