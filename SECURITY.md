# Security Policy

Decisive is a local-first Electron application for macOS. The native app stores task history on the user's Mac, while the public web preview is a separate, session-scoped demo. This policy explains how to report security concerns in either surface.

## Supported versions

Security work is focused on:

- the latest tagged macOS release;
- the current `main` branch; and
- the current dependency versions used by those builds.

There is no long-term-support release line. Older releases may not receive fixes, so reproduce a report on the latest release or `main` when possible.

## Reporting a vulnerability

Please report suspected vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/derinbarutcu17/decisive/security/advisories/new) when that option is available. Do not disclose exploit details in a public issue, discussion, pull request, or public commit.

If private vulnerability reporting is unavailable, contact `@derinbarutcu17` through a private contact method listed on the [maintainer's GitHub profile](https://github.com/derinbarutcu17). If no private route is available, open an issue titled `Private security contact` with no vulnerability details and ask for a private channel.

Please include enough information to reproduce and assess the report without attaching private task data:

- affected release, commit, or dependency version;
- whether the issue affects the packaged macOS app, local development server, or public web preview;
- macOS version and Mac architecture when relevant;
- a concise description of the impact and realistic attack conditions;
- minimal reproduction steps, proof of concept, or a safe test case; and
- relevant logs or screenshots with task titles, paths, tokens, and personal information redacted.

Do not include credentials, private task files, unredacted `data.json`, or live exploit payloads in the initial report. If a file is needed, describe the smallest safe fixture that demonstrates the issue.

## Project-specific security boundaries

- The packaged app persists tasks in macOS Application Support (currently under the `eisenhower` app-data directory). Development runs may use a `data.json` file beside the checkout. The application does not encrypt task data itself; protect the macOS account and its files accordingly.
- The local HTTP server and API are designed for local use and have no account or authentication layer. Do not intentionally expose port `4321` to an untrusted network.
- The [public web preview](https://decisive-three.vercel.app/) is not the native task store. It uses seeded, session-scoped data and should not be used for private tasks or sensitive reproduction data.
- Releases are currently unsigned. A normal macOS warning about an unsigned release is documented in the README; evidence of a modified, substituted, or malicious release should still be reported privately.

## Disclosure

The maintainer will triage reports as promptly as practical, work with the reporter on a fix or mitigation when appropriate, and coordinate public disclosure after users have a reasonable opportunity to update. Timing may depend on the affected dependency, release path, and severity. Reporters may request attribution.

There is currently no bug-bounty program or guaranteed response-time SLA.
