# Security policy

## Supported versions

Only the latest release on the default branch receives security fixes during Phase 1.

## Reporting a vulnerability

Please do not open public issues for vulnerabilities. Report privately through GitHub Security Advisories ("Report a vulnerability" on the repository's Security tab). Include affected version or commit, reproduction steps, and impact. We aim to acknowledge reports within 3 working days.

Especially relevant: ways to make the worker reach destinations the egress policy should refuse (private networks, metadata services, unlisted origins), authentication or session bypasses, artifact access without a session, and secrets persisting into stored evidence.

## Scope reminders for operators

FAULTLINE is designed for testing websites you control or are explicitly authorized to test. Read [docs/security.md](docs/security.md) before running it anywhere other than your own machine: public deployments require network-level isolation of the worker in addition to FAULTLINE's own checks.
