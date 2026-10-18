# Decisive project agent notes

## Agent control

- Any local agent controls this app through the `decisive` CLI on PATH
  (`~/.local/bin/decisive`, source: `cli/decisive.mjs`):
  `decisive list/show/add/edit/done/archive/restore/rm`, `--json` everywhere,
  unique id prefixes accepted. Run `decisive help` for the full surface.
- The CLI talks to the app's local HTTP API (127.0.0.1:4321) and starts a
  headless server with the same data file when the app is closed.
- Raw API: `GET/POST /api/tasks`, `PATCH/DELETE /api/tasks/:id`
  (fields: title, note, quadrant, importance, urgency, dueDate, done,
  archived, order; archiving requires done first).
- Data safety: the server keeps dated snapshots in a `backups/` folder next to
  the data file (`~/Library/Application Support/eisenhower/backups/`) plus
  `pre-restore` snapshots before any demo reset. Never delete task history or
  backups; archive instead of removing.

## Cloud mode (accounts)

- `cloud-config.js` + `cloud.js` add optional Supabase accounts (Google
  sign-in, Row Level Security). A signed-in session takes precedence inside
  `api()`; unconfigured or signed-out keeps the app local-first.
- Setup lives in `docs/cloud-setup.md` and `docs/cloud-schema.sql`. The anon
  key is a public browser key and is safe to commit.
- Never put a Supabase service-role key in this repo or the frontend.

## Delegation

- Delegate broadly for non-trivial work whenever subagent capacity is available; do not impose an arbitrary project-local numeric cap.
- Split work into independent, clearly bounded streams and prefer parallel investigation, implementation, and verification when their write scopes do not overlap.
- Platform, policy, and tool limits still apply. Do not attempt to bypass a hard runtime cap, create duplicate agents for the same unresolved task, or allow concurrent agents to edit the same files.
- Every delegated task should return concise evidence, changed paths, checks run, and remaining risks so the main agent can synthesize the result.

## UI review

- Keep the local web preview as the primary inspection surface until the user explicitly asks for a native build.
- Favor small, purposeful state changes over decorative motion. Respect reduced-motion preferences and preserve the existing Decisive visual system.

## Local macOS rebuilds

- `npm run dist` only writes `dist/mac-arm64/Decisive.app`. It does not update `/Applications/Decisive.app`, and a running app keeps serving its old bundle.
- For a local app update, inspect the running Decisive window with CUA first. If a task editor is open, save it before quitting. Quit Decisive normally, then run `npm run rebuild:local`. This command builds the unsigned app, checks for the requested UI marker, snapshots the task store, and installs the bundle into `/Applications` with rollback support. It refuses to replace a running app or a busy port.
- The task store is `~/Library/Application Support/eisenhower/data.json`; its `backups/` folder and `~/Library/Application Support/decisive` are persistent user data. Never delete, replace, or move them during an app rebuild. Replacing the `.app` bundle does not require changing them.
- After installation, launch `/Applications/Decisive.app` through CUA and verify the visible UI and the served page at `http://localhost:4321/` contain the new feature marker. Do not claim success from the `dist` bundle alone.
