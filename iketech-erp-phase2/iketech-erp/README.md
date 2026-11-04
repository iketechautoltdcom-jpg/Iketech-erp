# IKETECH AUTO ERP — Phase 1: Core Workshop

The operational system for IKETECH AUTO LTD, Port Harcourt. Phase 1 runs every vehicle from reception to follow-up with the four business gates enforced by the server and the database:

1. **No repair without customer approval** (or an authorised, recorded exception).
2. **No invoice without a QC pass** (or an authorised SKIP_QC exception).
3. **No vehicle release without full payment**, approved corporate credit, or an authorised exception.
4. **No closure without collection** (identity checked, keys out, mileage recorded) and a follow-up.

Every money movement is a balanced double-entry journal, every sensitive action is written to a hash-chained audit trail in the same transaction, and revenue, cash and receivables are computed from separate sources and reconciled against the ledger.

## What is in Phase 1

| Area | Delivered |
| --- | --- |
| Customers & vehicles | Individual and corporate customers, duplicate detection (phone, email, name; VIN and plate uniqueness), service history, credit limits and terms |
| Reception | Digital inspection (mileage, fuel, warning lights, damage, items in car, walk-around checklist), customer acknowledgment, key custody, automatic job card, mileage-rollback guard |
| Workshop | Job state machine (15 states), technician assignment, hold / resume / cancel, gate exceptions with segregation of duties |
| Diagnostics | Structured reports, DTC / freeze-frame / live-data / test / measurement / observation findings; a DTC alone is never accepted as proof |
| Quotations | Versioned quotations, VAT-inclusive or exclusive pricing, line discounts with role limits, partial approval, supplementary quotations, recorded approval evidence |
| Repairs & QC | Tasks only from approved lines, technician checklists and labour time, QC templates per repair category, independent QC, road test and post-scan requirements, automatic rework on failure |
| Billing | Invoices from approved completed work, cash / transfer / POS / cheque payments, clearing by a second person, receipts, deposits and overpayments, automatic release when paid |
| Ledger & reports | Double-entry ledger, trial balance, daily-to-annual summary with revenue vs cash vs receivables, ageing, ledger reconciliation |
| Security | Argon2id passwords, httpOnly SameSite=Strict sessions with idle timeout, lockout, rate limits, CSRF guard, RBAC on every route (enforced by a test), secrets scrubbed from logs and audit |
| Operations | Backup and restore-drill scripts, Docker deployment, CI workflow |

Phases 2–5 (receivables control, customer portal, WhatsApp, inventory, multi-branch) build on this schema; see the blueprint.

## Repository layout

```
apps/api      NestJS API (TypeScript), Kysely query builder, PostgreSQL migrations in db/migrations
apps/web      Next.js staff app (tablet and desktop)
ops/          backup.sh, restore-verify.sh
docs/         deployment, configuration, acceptance results, API reference, decisions
```

## Run it locally

Requirements: Node.js 22, PostgreSQL 16 (or Docker).

```bash
# 1. Database
createuser -P iketech            # password: choose one
createdb -O iketech iketech

# 2. API
cd apps/api
cp .env.example .env              # set DATABASE_URL and SESSION_SECRET
npm ci
npm run db:migrate
ADMIN_EMAIL=you@iketechauto.ng ADMIN_PASSWORD='a-strong-password-123' ADMIN_NAME='Your Name' npm run db:seed
npm run dev                        # http://localhost:4000/api/v1/health

# 3. Staff app
cd ../web && npm ci && npm run dev # http://localhost:3000
```

Optional demo data for training (never in production): `API_URL=http://localhost:4000 ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run db:demo` creates demo staff (`demo.advisor@example.test` etc., password `DemoPassword2026`) and six jobs at different stages, all marked DEMO.

With Docker: copy `.env.example` to `.env`, fill it in, `docker compose up -d --build`, then seed the first admin with `docker compose exec api node dist/db/seed.js` (pass ADMIN_EMAIL / ADMIN_PASSWORD with `-e`).

## Tests

```bash
cd apps/api && npm test
```

73 tests against a real PostgreSQL database (the test run creates and drops `iketech_test`). They cover acceptance scenarios 1–9, 11, 12 and 15, the database integrity triggers, money and tax arithmetic, and a check that every API route declares a permission. Results and the scenario mapping are in [docs/ACCEPTANCE.md](docs/ACCEPTANCE.md).

## Before go-live

Read [docs/DECISIONS.md](docs/DECISIONS.md). In short: confirm the 16 management decisions (they are settings with proposed defaults), have a Nigerian tax professional confirm the tax setup, set the diagnosis fee, review the QC templates, and run the restore drill on the production backup.
