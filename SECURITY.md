# Security Policy

## Reporting a vulnerability

Please report security issues privately using GitHub private vulnerability reporting:

<https://github.com/kckern/DaylightStation/security/advisories/new>

Do not open a public issue for a vulnerability. Include what you found, how to reproduce it, and the version or commit affected. We will acknowledge the report and keep you informed as it is investigated and fixed.

## Secrets never belong in issues

Never paste API keys, tokens, passwords, household configuration, or personal data into an issue, pull request, or log excerpt. Redact them first. If you accidentally publish a secret, rotate it immediately and tell the maintainers through the private channel above.

Household data and credentials live in the mounted data volume, never in this repository.
