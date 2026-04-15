# Contributing

Thanks for helping improve Binary Thinking Wiki.

## Development setup

1. Backend:
   - `cd backend`
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -e ".[dev]"`
2. Frontend:
   - `cd apps/web`
   - `npm ci`

## Local checks

1. Backend tests:
   - `cd backend && source .venv/bin/activate && pytest -q`
2. Frontend tests:
   - `cd apps/web && npm run test`
3. Frontend build:
   - `cd apps/web && npm run build`

## Pull request guidelines

1. Keep PRs focused and small.
2. Include test updates for behavior changes.
3. Explain user impact and migration notes in PR description.
4. Never commit secrets, API keys, or private datasets.
