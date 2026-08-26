# Contributing to Decisive

Thank you for helping improve Decisive. Contributions should keep the project focused, private by default, and dependable on the local machine.

## Understand the project boundary

- The packaged Electron/macOS app is the canonical Decisive experience. It keeps task history locally and works offline.
- The public Vercel site is a browser preview for design and interaction review. Its data is seeded and session-scoped; it is not a persistence or sync service.
- The native development server persists JSON task data locally. Never commit personal task history, screenshots containing it, or other private files.
- The repository is MIT-licensed. Bundled third-party code and fonts are documented in `THIRD_PARTY_NOTICES.md`.

For security vulnerabilities, follow [the security policy](SECURITY.md) instead of opening a public issue.

## Before you start

1. Search existing issues and pull requests so duplicate work can be combined.
2. For a bug, confirm whether it reproduces in the latest release or current `main`, and identify whether it affects the native app, local server, or web preview.
3. For a behavior or UI change, read the relevant [UI rulebook](docs/UI-RULEBOOK.md) and [interaction rulebook](docs/INTERACTION-RULEBOOK.md).
4. Keep changes focused. If a proposal changes persistence, packaging, release behavior, or the native/web boundary, call that out before implementation.

## Local setup

Use Node.js 22 locally to match the current CI runtime, then install dependencies:

```bash
npm install
```

Useful commands:

```bash
npm start                 # local server at http://127.0.0.1:4321
npm run app               # Electron development shell
npm test                  # fast deterministic API/static checks
npm run verify            # full isolated API, UI, layout, scatter, and label suite
npm run dist              # unsigned macOS directory build
```

`npm run verify` starts its own temporary fixture server and does not read personal task data. The individual Electron checks can also be run against a server on port `4321`:

```bash
npx electron test/scroll.test.cjs
TEST_TASK_ID=<disposable-task-id> npx electron test/ui.test.cjs
```

Create test data with a disposable fixture or isolated `DATA_FILE` where the command supports it. Use `examples/demo-data.json` for screenshots and deterministic examples. Do not use real task history as a fixture.

## Making changes

- Preserve the local-first behavior and the distinction between the native app and the public preview.
- Keep task persistence compatible with existing user data. If a change needs a data migration or changes where data is stored, explain the migration and recovery path in the pull request.
- Keep the local server and API behavior covered by tests when it changes.
- For UI work, verify the affected desktop and narrow-window states, keyboard interaction, and reduced-motion behavior. Include screenshots or a short recording when visual behavior is important to review.
- Do not add network services, account requirements, telemetry, or cloud synchronization without an explicit design decision and documentation.
- Do not commit secrets, private task data, generated build output, or local `data.json` files.

## Pull requests

A pull request should explain:

- what changed and why;
- which surface is affected: native macOS app, local development server, web preview, or shared code;
- how the change was tested, including commands and any tests not run;
- any compatibility, privacy, security, packaging, or data-migration considerations; and
- any documentation or screenshots a maintainer needs to review the change.

Keep the pull request description and the actual diff in agreement. Update the README or rulebooks when the user-visible contract changes. The repository's pull-request template includes the review checklist.

If AI tools assisted with the work, the contributor remains responsible for understanding the change, checking licenses, reviewing generated content, and verifying the result locally.

## Reporting problems

Use the bug and feature templates when they fit. Include sanitized reproduction details and specify whether the report concerns the native app or the web preview. Do not use public issue forms for security vulnerabilities; use [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contribution may be distributed under the repository's [MIT License](LICENSE).
