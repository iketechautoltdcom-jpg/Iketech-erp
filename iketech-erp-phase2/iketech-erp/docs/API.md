# API reference (v1)

All routes are under `/api/v1`. Every route requires a signed-in session and the listed permission unless marked public. State-changing requests must send `X-Requested-With: iketech-erp`. Money is sent in naira and returned in kobo (integer). Errors return `{ code, message, details }` with a stable `code`.


## auth

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/auth/login` | public |
| POST | `/auth/logout` | any signed-in user |
| GET | `/auth/me` | any signed-in user |

## health

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/health` | public |

## admin

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/staff` | jobs.read |
| GET | `/users` | users.manage |
| GET | `/roles` | users.manage |
| POST | `/users` | users.manage |
| PUT | `/users/:id/roles` | users.manage |
| POST | `/users/:id/status` | users.manage |
| GET | `/settings` | settings.manage, audit.read |
| PUT | `/settings/:key` | settings.manage |
| GET | `/tax-configurations` | settings.manage, audit.read |
| POST | `/tax-configurations` | settings.manage |
| GET | `/audit` | audit.read |
| GET | `/audit/verify` | audit.read |

## billing

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/jobs/:id/invoice` | invoices.create |
| POST | `/jobs/:id/release` | jobs.advance, payments.clear |
| GET | `/invoices` | invoices.read |
| GET | `/invoices/:id` | invoices.read |
| POST | `/payments` | payments.record |
| GET | `/payments` | payments.read |
| POST | `/payments/:id/clear` | payments.clear |
| POST | `/payments/:id/fail` | payments.reverse |
| GET | `/payments/:id/receipt` | payments.read |

## crm

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/customers` | customers.read |
| GET | `/customers/duplicates` | customers.read |
| POST | `/customers` | customers.write |
| GET | `/customers/:id` | customers.read |
| PATCH | `/customers/:id` | customers.write |
| PATCH | `/customers/:id/credit` | payments.clear |
| POST | `/customers/:id/vehicles` | customers.write |
| GET | `/vehicles` | customers.read |
| GET | `/vehicles/:id` | customers.read |

## files

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/attachments` | jobs.read |
| GET | `/attachments` | jobs.read |
| GET | `/attachments/:id` | jobs.read |

## reports

| Method | Path | Permission |
| --- | --- | --- |
| GET | `/reports/summary` | reports.operational, reports.financial |
| GET | `/reports/trial-balance` | reports.financial |

## workshop

| Method | Path | Permission |
| --- | --- | --- |
| POST | `/reception` | reception.create |
| GET | `/jobs` | jobs.read |
| GET | `/jobs/:id` | jobs.read |
| POST | `/jobs/:id/assign` | jobs.assign |
| POST | `/jobs/:id/start-diagnosis` | jobs.advance, jobs.assign |
| POST | `/jobs/:id/hold` | jobs.hold |
| POST | `/jobs/:id/resume` | jobs.hold |
| POST | `/jobs/:id/cancel` | jobs.hold |
| POST | `/jobs/:id/deliver` | jobs.advance |
| POST | `/jobs/:id/follow-up` | jobs.advance |
| POST | `/jobs/:id/exceptions` | exceptions.request |
| GET | `/exceptions/pending` | exceptions.authorise |
| POST | `/exceptions/:id/authorise` | exceptions.authorise |
| POST | `/exceptions/:id/reject` | exceptions.authorise |
| POST | `/jobs/:id/diagnostic-report` | diagnostics.write |
| PUT | `/diagnostic-reports/:id` | diagnostics.write |
| POST | `/diagnostic-reports/:id/findings` | diagnostics.write |
| POST | `/diagnostic-reports/:id/submit` | diagnostics.write |
| POST | `/jobs/:id/quotations` | quotations.write |
| GET | `/quotations/:id` | quotations.read |
| PUT | `/quotations/:id` | quotations.write |
| POST | `/quotations/:id/send` | quotations.write |
| POST | `/quotations/:id/decision` | quotations.record_approval |
| POST | `/jobs/:id/start-repair` | jobs.advance, jobs.assign |
| POST | `/tasks/:id/assign` | jobs.assign |
| POST | `/tasks/:id/start` | repairs.write |
| POST | `/tasks/:id/complete` | repairs.write |
| POST | `/jobs/:id/submit-qc` | repairs.write, jobs.advance |
| POST | `/jobs/:id/skip-qc` | jobs.advance, jobs.assign |
| GET | `/jobs/:id/qc-template` | jobs.read |
| POST | `/jobs/:id/qc` | qc.inspect |
