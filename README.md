# Secret Santa Coordinator

A private, constraint-aware Secret Santa app built on Cloudflare Workers and D1.

## Features

- Generates one continuous circular giving order containing every participant exactly once.
- Supports directed giver-to-recipient exclusions and clearly reports impossible exchanges.
- Issues unique four-digit PINs and reveals only the authenticated participant's recipient.
- Stores only salted PBKDF2 PIN hashes and a SHA-256 organizer-token hash.
- Preserves timestamped reset and restore events in D1 without exposing exchange history in the
  normal interface.
- Provides a private recovery screen at `/?recovery=1` for exchanges created in the same browser.

## Local development

```bash
npm install
npm run db:migrate:local
npm run dev
```

Run the focused checks with:

```bash
npm test
npm run check
```

## Deployment

Create the D1 database once, place its ID in `wrangler.toml`, then apply migrations and deploy:

```bash
wrangler d1 create secret-santa-coordinator-v1
npm run db:migrate:remote
npm run deploy
```
