# Decisive architecture and data contract

Decisive is a local-first task board with a browser preview and a native macOS shell. The macOS application is canonical; the Vercel preview is a disposable demonstration surface.

## Runtime boundaries

- `index.html`, `style.css`, `app.js`: the shared interface and interaction model.
- `server.js`: the local HTTP API used by development and Electron.
- `api/tasks.js`: the stateless Vercel adapter. Browser preview persistence falls back to local storage and must not be treated as a durable cloud database.
- `main.cjs`: starts the local API, opens the Electron window, and selects the macOS Application Support data file.
- `examples/demo-data.json`: sanitized demo fixture only. It must never be used as a personal data store.

## Task lifecycle

```text
active task
  ├─ quadrant: do | schedule | delegate | eliminate
  ├─ done: false
  └─ archived: false

completed task
  ├─ done: true
  ├─ doneAt: ISO timestamp
  └─ archived: false

archived task
  ├─ done: true
  ├─ archived: true
  └─ archivedAt: ISO timestamp
```

Only completed tasks may enter the archive. The 30-day retention rule archives old completed tasks; it does not silently destroy them. Explicit delete actions are separate and irreversible after confirmation.

## Persistence contract

The local server writes the JSON store atomically through a temporary file and rename. Packaged macOS builds use `~/Library/Application Support/Decisive/data.json`; the repository-level `data.json` is ignored so personal tasks never enter Git.

Any future task-field change must include a migration path. Do not rename or remove a persisted field without:

1. a schema version or migration function;
2. a fixture covering the old shape;
3. a backward-compatible read or a documented upgrade;
4. a regression test that proves existing data survives the migration.

## Demo reset contract

“Restore demo content” replaces the current board with the bundled sanitized fixture. It must remove personal rows, restore active examples in all four quadrants, restore visible completed examples, and remain repeatable. It must not copy data from the native Application Support directory.

## Recovery expectations

Before a major schema or release change, users should be able to copy their local `data.json` as a backup. A future export/import command should produce a versioned JSON bundle rather than asking users to edit the store manually.
