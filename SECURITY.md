# Security Policy

## Supported versions

Only the latest `main` branch is actively supported.

## Reporting a vulnerability

Please do not open a public issue for security problems.

Report privately to the maintainer first:

- GitHub account: `二进制思考`
- Include reproduction steps, impact, and affected files/endpoints

We will acknowledge reports as quickly as possible and coordinate a fix and disclosure timeline.

## Security notes

1. Browser API keys are treated as session-only and are not persisted to disk.
2. Bridge file-system APIs are restricted to configured safe roots by default.
3. For local trusted experiments only, unsafe bridge mode can be enabled with:
   - `LLM_WIKI_ALLOW_UNSAFE_BRIDGE_PATHS=true`
