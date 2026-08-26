# Decisive repository hygiene audit

Audited 26 August 2026 against the `main` branch and the public repository configuration. The repository already has a strong product foundation: an MIT license, a lockfile, sanitized demo fixtures, responsive screenshots, rulebooks, a native release workflow, and several focused regression tests. The gaps below are mostly about making those good ingredients enforceable and repeatable.

## Current baseline

- `npm test` runs `test/api.test.mjs` and `test/vercel-config.test.mjs` only.
- Additional tests exist for UI smoke behavior, scroll/fade behavior, scatter behavior, label motion, layout, labels, and approved-scope contracts, but they are not part of the default CI command.
- `.github/workflows/test.yml` uses Node 22 directly instead of a repository-pinned toolchain file.
- `.github/workflows/release.yml` builds unsigned macOS artifacts on version tags, but the repository currently has no published GitHub release.
- GitHub reports `main` as unprotected.
- GitHub Dependabot security updates/alerts are disabled; `npm audit --omit=dev` was clean at audit time.
- There are no repository-level `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `CODEOWNERS`, issue templates, pull-request template, or changelog/change-entry convention.
- The README is already unusually good for a small app: it explains the web preview/native distinction, offline storage, unsigned macOS launch approval, local development, packaging, and screenshots.

## What seasoned projects do

### Electron: review, security, ownership, and supply chain

- [Electron `CONTRIBUTING.md`](https://github.com/electron/electron/blob/main/CONTRIBUTING.md) gives contributors a defined issue/PR/testing/release path and explicitly requires human review of AI-assisted work.
- [Electron `SECURITY.md`](https://github.com/electron/electron/blob/main/SECURITY.md) routes vulnerabilities to private GitHub Security Advisories and defines escalation expectations.
- [Electron `PULL_REQUEST_TEMPLATE.md`](https://github.com/electron/electron/blob/main/.github/PULL_REQUEST_TEMPLATE.md) asks for tests, documentation, release notes, and a verified description before merge.
- [Electron `CODEOWNERS`](https://github.com/electron/electron/blob/main/.github/CODEOWNERS) assigns owners to dependency, release, security, and infrastructure paths.
- [Electron `dependabot.yml`](https://github.com/electron/electron/blob/main/.github/dependabot.yml) updates npm and GitHub Actions on a schedule with an explicit open-PR limit.
- [Electron Scorecards workflow](https://github.com/electron/electron/blob/main/.github/workflows/scorecards.yml) defaults workflow permissions to read-only, pins actions to immutable SHAs, and scans the supply chain.

### VS Code: contributor ergonomics and issue quality

- [VS Code `CONTRIBUTING.md`](https://github.com/microsoft/vscode/blob/main/CONTRIBUTING.md) tells people where to ask questions, how to avoid duplicate issues, and exactly what a reproducible report must include: version, OS, steps, expected/actual behavior, media, and console errors.
- [VS Code `CODEOWNERS`](https://github.com/microsoft/vscode/blob/main/.github/CODEOWNERS) requires review for high-impact workflows and stable API contracts.
- [VS Code `.nvmrc`](https://github.com/microsoft/vscode/blob/main/.nvmrc) pins the development runtime so local and CI environments do not silently drift.

### Tauri: release traceability and change discipline

- [Tauri change-entry convention](https://github.com/tauri-apps/tauri/blob/dev/.changes/README.md) records the semantic version bump and a user-facing summary with each change.
- Tauri’s repository also provides separate workflows for formatting, linting, tests, generated-file checks, and releases rather than hiding every quality gate behind one vague job.

## Priority upgrade plan

### P0 — make “green” mean the app is actually safe to ship

1. Add a `verify` script that runs every existing deterministic suite, then make CI call only that command.
2. Add a packaging smoke check that builds the Electron app and verifies the expected files, icon, app name, and `examples/demo-data.json` are present.
3. Add a `.nvmrc`/`.node-version` and consume it from test and release workflows.
4. Protect `main`: require the `verify` check, require pull requests, block force pushes, and require branches to be up to date before merge.

### P1 — make releases auditable

5. Add a release preflight: tag must equal `package.json` version, `verify` must pass, both arm64 and x64 artifacts must exist, and a SHA-256 manifest must be uploaded.
6. Publish the first tagged GitHub release and link it from the README. The current tag workflow exists, but there is no release history yet.
7. Add a small `changes/` convention or `CHANGELOG.md` so every release explains user-visible changes, migration notes, and known limitations.
8. Document the unsigned-app policy in the release checklist and, when Apple signing becomes available, add notarization as a separate required gate.

### P1 — make contribution and security paths professional

9. Add `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.github/PULL_REQUEST_TEMPLATE.md`, and bug/feature issue forms.
10. Add `.github/CODEOWNERS` for `main.cjs`, `server.js`, `api/**`, `package.json`, `.github/workflows/**`, and release configuration.
11. Enable Dependabot security updates and add scheduled npm/Actions update PRs; keep the current clean `npm audit` result as a CI check.
12. Add an action supply-chain check and pin third-party workflow actions to commit SHAs, at least for the release workflow.

### P2 — reduce future maintenance cost

13. Add a short architecture document covering the task state machine: active → done → archived, local JSON persistence, preview fallback, and demo reset semantics.
14. Add a versioned data-schema migration helper before changing task fields again; this matters because the native app must preserve existing user data across updates.
15. Add export/import and backup/restore documentation for the local task file.
16. Add a small dependency policy: runtime vs development dependencies, update cadence, and the rule that the lockfile must change with dependency changes.
17. Add CI artifact retention for screenshots from UI smoke runs so layout regressions are reviewable rather than invisible.

## The five highest-return changes

If the goal is a professional 10/10 repo without overbuilding, do these first:

1. Unified `verify` gate.
2. Protected `main` with required CI.
3. Pinned Node plus Dependabot and pinned Actions.
4. Release preflight + first tagged release + checksums.
5. Security/contributor/PR templates.

These changes preserve the current product direction while making it difficult for the most expensive classes of regression—broken persistence, broken packaging, untested UI geometry, and unsafe release automation—to reach the canonical branch.
