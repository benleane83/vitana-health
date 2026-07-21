# Contributing to Vitana Health

Thank you for your interest in contributing. This document covers everything you need to know before opening a pull request.

## License and copyright

This project is licensed under the **GNU Affero General Public License v3.0 only** (`AGPL-3.0-only`). See [LICENSE](LICENSE) for the full text.

By submitting a contribution you confirm that:

1. You wrote the contribution yourself, or have the right to submit it under the AGPL-3.0-only license.
2. Your contribution is licensed to the project under AGPL-3.0-only.
3. You understand that AGPL-3.0-only is a strong copyleft license — derivative works and modified versions that are run over a network must also be released under the same license.

**No Contributor License Agreement (CLA) is required.** The AGPL-3.0-only license covers all contributions automatically.

## Code of conduct

This project follows basic open-source norms: be respectful, assume good faith, and keep discussion focused on the work. Harassment, personal attacks, and discriminatory language are not tolerated. Violations can be reported to the maintainer (see [SECURITY.md](SECURITY.md) for contact details).

## What kinds of contributions are welcome?

- Bug fixes and correctness improvements.
- Security fixes (please follow the [responsible disclosure process](SECURITY.md) for vulnerabilities before opening a PR).
- Accessibility improvements (the project targets WCAG AA).
- Performance and reliability improvements in line with the existing architecture.
- Documentation fixes and improvements.
- Test coverage for untested code paths.

**Please open an issue or start a discussion before beginning significant new features.** The project has a deliberate local-first, multi-profile, privacy-first scope, and substantial new features should be validated against that direction first.

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

Core and desktop tests run in the regular CI workflow. Integration tests run on `main` and on pull requests that change API, web, shared, or test-runner files. Durability tests run nightly, for prerelease tags, and on demand.

See [`.env.example`](.env.example) for environment variable documentation, and [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md) for the API reference.

## Submitting a pull request

1. **Fork** the repository and create a branch from `main`.
2. **Write or update tests** for any behaviour you change. Run `npm test` and the integration or durability suite when your change touches those boundaries.
3. **Type-check** before submitting: `npm run typecheck`.
4. **Keep commits focused.** One logical change per commit makes review easier.
5. **Describe what and why** in the PR description, not just what changed. Link any related issues.
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
