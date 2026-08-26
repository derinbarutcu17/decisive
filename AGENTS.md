# Decisive project agent notes

## Delegation

- Delegate broadly for non-trivial work whenever subagent capacity is available; do not impose an arbitrary project-local numeric cap.
- Split work into independent, clearly bounded streams and prefer parallel investigation, implementation, and verification when their write scopes do not overlap.
- Platform, policy, and tool limits still apply. Do not attempt to bypass a hard runtime cap, create duplicate agents for the same unresolved task, or allow concurrent agents to edit the same files.
- Every delegated task should return concise evidence, changed paths, checks run, and remaining risks so the main agent can synthesize the result.

## UI review

- Keep the local web preview as the primary inspection surface until the user explicitly asks for a native build.
- Favor small, purposeful state changes over decorative motion. Respect reduced-motion preferences and preserve the existing Decisive visual system.
