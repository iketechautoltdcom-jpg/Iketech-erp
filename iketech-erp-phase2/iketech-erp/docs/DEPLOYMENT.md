# Deployment

## Target architecture

```
Internet ──TLS──> reverse proxy / load balancer ──> web (Next.js :3000) ──> api (NestJS :4000) ──> PostgreSQL 16
                                                                              └──> private file storage
```

The browser only ever talks to `web`. `web` forwards `/api/v1/*` to `api`, so the session cookie stays first-party, httpOnly and `SameSite=Strict`.

## Recommended production setup

| Component | Recommendation |
| --- | --- |
| Database | Managed PostgreSQL 16 with automated daily backups, point-in-time recovery (WAL) and encryption at rest. Choose the region with the lowest latency to Port Harcourt that meets your data-residency requirements. |
| App servers | Two containers (`apps/api`, `apps/web`) on any container host. 1 vCPU / 1 GB each is enough for one branch. |
| Files | Mount a persistent, encrypted, backed-up volume at `STORAGE_DIR` (default `/data/storage`). Phase 3 replaces this adapter with S3-compatible private object storage; the `attachments` table does not change. |
| TLS | Terminate HTTPS at the proxy with HSTS. Redirect HTTP to HTTPS. |
| Monitoring | Uptime check on `GET /api/v1/health`; collect container logs (they contain no request bodies or secrets); alert on 5xx rates. |

## Environment variables

API (`apps/api`):

| Variable | Required | Notes |
| --- | --- | --- |
| `DATABASE_URL` | yes | Use a dedicated DB user. Add `?sslmode=require` for a remote database. |
| `SESSION_SECRET` | yes | 32+ random characters (`openssl rand -base64 48`). The API refuses to start in production without it. |
| `WEB_ORIGIN` | yes | Public origin of the staff app, e.g. `https://erp.iketechauto.ng`. Used for CORS and the CSRF origin check. Comma-separate several. |
| `NODE_ENV` | yes | `production` (enables Secure cookies). |
| `PORT` | no | Default 4000. |
| `STORAGE_DIR` | no | Private file storage path. |
| `MIGRATE_ON_START` | no | `true` applies pending migrations at start-up. Otherwise run `node dist/db/migrate.js`. |
| `RATE_LIMIT_PER_MIN` | no | Global per-IP limit, default 600. Login is limited to 10 per minute per IP. |

Web (`apps/web`): `API_INTERNAL_URL` — the URL `web` uses to reach `api` (e.g. `http://api:4000`). Next.js fixes this value into the build, so pass it as a build argument (docker-compose.yml already does) and rebuild the web image if it changes.

## First deployment

1. Provision PostgreSQL; create database `iketech` and user `iketech`.
2. Build and start the containers (`docker compose up -d --build` on a single server, or your platform's equivalent).
3. Apply migrations (automatic with `MIGRATE_ON_START=true`).
4. Seed configuration and the first CEO account:
   `docker compose exec -e ADMIN_EMAIL=… -e ADMIN_PASSWORD=… -e ADMIN_NAME=… api node dist/db/seed.js`
5. Sign in, create staff accounts under Administration, and review Settings & tax.
6. Run a backup and a restore drill (below) before taking real customers.

## Upgrades

Migrations are forward-only, numbered SQL files. The runner records a checksum for each and refuses to start if an applied migration was edited. To upgrade: take a backup, deploy the new images, let migrations apply, check `/api/v1/health`.

## Backups and restore drill

```bash
# Daily (cron/scheduler). Optional GPG encryption and 35-day retention.
DATABASE_URL=… BACKUP_DIR=/var/backups/iketech BACKUP_GPG_RECIPIENT=ops@… ops/backup.sh

# Monthly drill — restores into a throwaway database and verifies it.
ADMIN_DATABASE_URL=postgresql://…/postgres SOURCE_DATABASE_URL=$DATABASE_URL ops/restore-verify.sh /var/backups/iketech/iketech-….dump
```

The drill checks the file checksum, that migrations are present, that the audit hash chain is intact, that every journal entry balances, that the trial balance balances, that ledger receivables equal open invoice balances, and that row counts match the live database. Exit code 0 means the backup can be trusted. Keep the drill output as evidence.

Managed-database PITR is the first line of recovery (target: lose at most 5 minutes). The logical dumps above are the independent second copy; store them in a different account or region.

## Security checklist before go-live

- [ ] HTTPS only, HSTS on, HTTP redirected.
- [ ] `NODE_ENV=production`, strong `SESSION_SECRET`, `WEB_ORIGIN` set to the real domain.
- [ ] Database not reachable from the internet; app user has no superuser rights.
- [ ] The bootstrap admin password changed after first sign-in; one named account per person, no shared logins.
- [ ] Backups running, restore drill passed, backup copies stored separately.
- [ ] `tax.confirmed_by_adviser` switched on only after professional confirmation.
- [ ] Demo data never loaded (the demo script refuses to run when `NODE_ENV=production`).

## Render (recommended when there is no dedicated IT person)

`render.yaml` at the repository root is a Render Blueprint. It creates:

| Part | Render type | Notes |
| --- | --- | --- |
| `iketech-db` | PostgreSQL 16, Frankfurt | Private network only (`ipAllowList: []`). Render's paid databases include daily backups. |
| `iketech-api` | Private service (Docker, `apps/api`) | Not reachable from the internet. 10 GB disk at `/data/storage` for photos and documents. `SESSION_SECRET` is generated by Render. |
| `iketech-web` | Web service (Docker, `apps/web`) | The only public part. Reaches the API over Render's private network via `API_INTERNAL_URL`. |

Steps: push the repository to GitHub → Render → New → Blueprint → choose the repository → enter `WEB_ORIGIN` when asked → Apply. After the first deploy, open `iketech-api` → Shell and run
`ADMIN_EMAIL=… ADMIN_PASSWORD=… ADMIN_NAME="…" node dist/db/seed.js` to create the CEO account.

If you add a custom domain to `iketech-web`, update `WEB_ORIGIN` on `iketech-api` to match.
`API_INTERNAL_URL` is fixed into the web build, so if the API service is ever renamed or recreated, redeploy `iketech-web` with **Clear build cache & deploy**.
