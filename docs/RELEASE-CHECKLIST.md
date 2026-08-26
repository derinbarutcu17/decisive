# Decisive release checklist

The macOS app is canonical, unsigned, and distributed through GitHub Releases.

## Before tagging

- [ ] `npm ci` completes from the lockfile.
- [ ] `npm run verify` passes.
- [ ] `npm run release:preflight` passes locally.
- [ ] `CHANGELOG.md` contains the user-facing changes and any migration notes.
- [ ] No personal `data.json`, screenshots, build output, or secrets are staged.

## Tag and publish

1. Update `package.json` and `package-lock.json` to the release version.
2. Commit the changelog and version update.
3. Push the commit and create a matching `v<version>` tag.
4. Let the macOS release workflow build arm64 and Intel `.dmg`/`.zip` artifacts.
5. Confirm `SHA256SUMS.txt` is attached to the GitHub Release.
6. Download one artifact and verify it launches, persists a task, restarts, and preserves the task.

## After publishing

- [ ] The README “latest release” link resolves.
- [ ] The unsigned-app launch instructions still match the current macOS behavior.
- [ ] The public web preview still clearly says it is a disposable demo and not the canonical task store.
