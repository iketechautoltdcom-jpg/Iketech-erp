# Decisions, deviations and open items — Phase 1

## Deviations from the blueprint

| Blueprint | Built | Why |
| --- | --- | --- |
| Prisma ORM | Kysely (typed SQL query builder) with hand-written PostgreSQL migrations; types generated from the database with `npm run db:types` | Prisma's engine binaries could not be downloaded in the build environment. The spec allows "Prisma or equivalent". Kysely needs no native engine, and writing migrations in SQL put every integrity rule (balanced journals, immutable invoices, append-only audit, the job state machine, segregation-of-duties checks) directly in the database. |
| Reapproval when price rises beyond a threshold | Any change to a sent quotation issues a new version that needs a fresh customer decision | Stricter than the threshold and simpler to audit. The threshold setting can still be added if management wants small changes to go through without re-approval. |
| Private object storage with signed URLs | Private disk storage streamed only to signed-in staff | Same access rules; the S3 adapter arrives with the customer portal in Phase 3 without changing the `attachments` table. |
| Notifications (WhatsApp / SMS / email) | Not in Phase 1. Staff record how and when each quotation was sent. | Blueprint places notifications in Phase 3. |
| MFA for privileged roles | Not yet enforced; the `mfa_secret` column and role list are in place | Scheduled for Phase 2 alongside financial controls. Until then, keep CEO / Accountant passwords long and unique. |

## Known Phase 1 limits

- **Reversing a payment that is already applied to an invoice** is refused. It needs the credit-note workflow (Phase 2). Pending payments can be marked failed, and cleared but unapplied payments can be reversed, both by someone other than the recorder.
- **Voiding or correcting an issued invoice** is not available; invoices are immutable by design. Credit notes come in Phase 2.
- **One live invoice per job.** Supplementary work is quoted and approved before invoicing, so it is included on the same invoice.
- **Single branch in the UI.** Every table already carries `branch_id`; branch switching arrives in Phase 5.
- **Overdue** means the due date (Lagos calendar day) is before today. Invoices issued with zero payment terms are due the same day and become overdue the next day.

## Management decisions (Blueprint §12) — current values

All are settings or data, changeable without code under Administration → Settings & tax (every change audited).

| # | Decision | Value in the system now | Where |
| --- | --- | --- | --- |
| 1 | Reapproval threshold | Every change re-approved (see above) | — |
| 2 | Discount limits | Advisor 0 %, Ops Manager 10 %, CEO 100 % | `approval_limits` table |
| 3 | PO / expense limits | Phase 2 and 4 | — |
| 4 | Diagnosis fee on decline | On, **amount not set** — set `diagnosis.fee_kobo` before it can be invoiced | Settings |
| 5 | Release before full payment | Corporate customers within credit limit and terms with nothing overdue, or an authorised exception | Code rule + customer credit terms |
| 6 | Deposit for special parts | Phase 4 (parts ordering) | — |
| 7 | Independent QC + road test categories | Brakes, steering/suspension, engine, transmission, electrical safety | `qc_templates` (starter checklists for the Ops Manager to review) |
| 8 | Technician cost rates | Phase 2 (job costing) | — |
| 9 | Tax treatment | VAT standard 7.5 %, exempt and zero-rated codes seeded; **`tax.confirmed_by_adviser` is false** until a tax professional confirms | Settings & tax |
| 10 | Chart of accounts | Eight starter accounts (cash, bank, receivables, deposits, output VAT, three revenue lines) | `accounts` table |
| 11 | Payment gateway / SMS provider | Not chosen | — |
| 12 | Quotation validity / deadline | 7 days valid, decision due in 48 hours | Settings |
| 13 | Storage charges | Not implemented | — |
| 14 | Data retention | Not set; financial records are never deleted | Legal adviser |
| 15 | Hosting | Not chosen; see DEPLOYMENT.md | — |
| 16 | Branch and number formats | `PH`; `JOB-PH-2026-00001`, `QUO-…`, `INV-PH-2026-000001`, `RCT-…`, gapless per branch per year | Seed / `number_sequences` |

## Still needed from IKETECH

- V5 exports or screenshots, to build the staged import (Blueprint §11).
- Labour rates and common parts prices (quotation lines are typed in until the parts catalogue arrives in Phase 4).
- The company's TIN, RC number, address and bank details for invoice headers (left off rather than invented).
- Current invoice and quotation templates, if the printed layout must match them.
- The QC checklists already in use, to replace or extend the starter templates.
