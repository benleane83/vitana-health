# Contributing to Vitana Health

Thank you for your interest in contributing. This document covers everything you need to know before opening a pull request.

## License and copyright

This project is source-available under the **Elastic License 2.0**
(`Elastic-2.0`). See [LICENSE](LICENSE) for the full terms. Elastic-2.0 is not an
Open Source license under the Open Source Initiative definition.

The project is not currently accepting unsolicited code or documentation
contributions. This keeps copyright ownership and future licensing options
clear while the product is under active development.

Do not open a pull request unless the maintainer has agreed to the proposed work
and its contribution terms in writing. Approval to discuss or implement a
change does not by itself transfer copyright or grant the project relicensing
rights. Unsolicited pull requests will not be merged.

Issue reports, feature suggestions, and other feedback remain welcome. Security
vulnerabilities must use the private process in [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows basic community norms: be respectful, assume good faith, and keep discussion focused on the work. Harassment, personal attacks, and discriminatory language are not tolerated. Violations can be reported to the maintainer (see [SECURITY.md](SECURITY.md) for contact details).

## What kinds of feedback are welcome?

- Reproducible bug reports and correctness issues.
- Security reports submitted through the [responsible disclosure process](SECURITY.md).
- Accessibility findings (the project targets WCAG AA).
- Performance and reliability observations.
- Documentation errors and unclear instructions.
- Focused feature suggestions consistent with the product scope.

The project has a deliberate local-first, multi-profile, privacy-first scope.
Please start with an issue or discussion rather than implementing a proposed
change.

## Non-medical use boundaries

All contributions must stay within the app's defined safety boundaries: wellness-oriented summaries and questions to discuss with a clinician. Contributions that add diagnostic conclusions, treatment recommendations, medication guidance, or urgency triage will not be accepted.

## Development setup

Use Node.js 22 and npm 10, as pinned by `.nvmrc`, `package.json`, and CI.

```powershell
# Install dependencies
npm ci

# Run API and web UI together
npm run dev

# Run the fast core suite
npm test

# Type-check everything
npm run typecheck
```

The API binds to `127.0.0.1:4317` and the web UI to `127.0.0.1:5173`.

## Codebase map

This npm workspace is organized around these dependency boundaries:

| Area | Path | Depends on | Responsibility |
|---|---|---|---|
| Shared domain | `packages/shared` | — | Schemas, parsers, analytics, and platform-neutral domain logic |
| API client | `packages/api-client` | Shared | Typed API transport used by browser and companion clients |
| API and storage | `apps/api` | Shared | Express API, profile lifecycle, encrypted DuckDB repositories, imports, analytics, pairing, and reports |
| PC web UI | `apps/web` | Shared, API client | React/Vite desktop browser interface |
| Mobile companion | `apps/android-companion` | Shared, API client | Expo/React Native companion, demo mode, pairing, and native adapters |
| Desktop host | `apps/desktop` | API; packaged web output | Electron secure storage, process lifecycle, and Windows installer |

Keep database-specific operations behind the storage abstractions in `apps/api/src/storage`. Runtime code must not restore the retired JSON profile backend or perform whole-profile reads. Shared and API-client changes can affect every app and therefore require broader validation than leaf-workspace changes.

## Validation commands

Use the narrowest command that covers a change, then run `npm run validate:fast` before submitting ordinary changes.

| Changed area | Command | Additional boundary validation |
|---|---|---|
| Shared domain | `npm run validate:shared` | Run affected app validation because all apps consume it |
| API routes and services | `npm run validate:api` | `npm run test:integration` for HTTP or lifecycle behavior |
| Web UI | `npm run validate:web` | `npm run test:integration` for full UI/API flows |
| Android companion | `npm run validate:android` | Use manually dispatched Android native CI for native modules or permissions |
| Electron/packaging | `npm run validate:desktop` | Use manually dispatched Windows desktop smoke CI for packaging changes |
| Storage, encryption, or recovery | `npm run validate:storage` | Includes integration and durability suites; Windows CI remains authoritative |

`npm run validate:fast` runs workspace type-checking, production builds, core tests, and desktop tests. `npm run validate:all` additionally runs integration, durability, and dependency-audit checks.

The Copilot cloud agent uses `.github/workflows/copilot-setup-steps.yml` to install locked dependencies, rebuild DuckDB, and build shared workspaces before an agent starts. Changes to that workflow or the root package manifests run the setup workflow as a normal check; it can also be run manually from the Actions tab. The setup file must be present on the default branch before Copilot uses it.

## Test suites

Tests are separated by runtime cost and failure mode:

```powershell
# Fast unit, transformation, mocked, and component tests
npm run test:core

# Serial full-App, Express, DuckDB lifecycle, and certificate tests
npm run test:integration

# Process-termination and interrupted-transaction recovery tests
npm run test:durability

# Electron packaging configuration and secure-store tests
npm run test:desktop
```

Signed LAN desktop packages use immutable build-time inputs and a strict feed
server. See [`docs/WINDOWS_RELEASE.md`](docs/WINDOWS_RELEASE.md) before running
`npm run package:desktop:lan` or
`npm run serve:desktop:updates -- --lan --root apps/desktop/dist --port 8082`.

Core and desktop tests run in the regular CI workflow. Integration tests run on `main` and on pull requests that change API, web, shared, or test-runner files. Durability tests run nightly, for prerelease tags, and on demand.

See [`.env.example`](.env.example) for environment variable documentation, and [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) for the API reference.

## Approved pull requests

These steps apply only after the maintainer has approved the work and confirmed
the required contribution terms in writing:

1. **Fork** the repository and create a branch from `main`.
2. **Write or update tests** for any behaviour you change. Run `npm test` and the integration or durability suite when your change touches those boundaries.
3. **Type-check** before submitting: `npm run typecheck`.
4. **Keep commits focused.** One logical change per commit makes review easier.
5. **Describe what and why** in the PR description, not just what changed. Link the approval discussion and any related issues.
6. Open the PR against `main`.

CI will run type-checking, tests, and a dependency security audit automatically. PRs are not merged until all checks pass.

## Health data and privacy

The app handles sensitive personal health data. Contributions must not:

- Add telemetry, cloud sync, or vendor data upload paths without explicit user consent.
- Weaken the encrypted-store protections, atomic write path, or backup/recovery logic.
- Cause health data to be included in API responses, logs, or error messages beyond what is already documented.
- Expand the cloud prompt payload beyond the documented minimization policy.

## Support and release policy

This project is maintained on a best-effort basis. There is no guaranteed response time for issues or PRs, and no backport policy — security fixes land on `main` only.

If you are using this application in a sensitive context, keep up to date with `main` and review the [SECURITY.md](SECURITY.md) for guidance on the threat model and responsible disclosure.
