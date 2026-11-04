# Acceptance results — Phase 1

Run on 1 November 2026 against PostgreSQL 16 with the real migrations, triggers and constraints (`cd apps/api && npm test`).
**Result: 73 of 73 tests passed.**

## Scenario mapping (Blueprint §10)

| # | Scenario | Phase | Status | Where it is proved |
| --- | --- | --- | --- | --- |
| 1 | Customer and vehicle registered without duplicates | 1 | Passed | `AT-1` — references issued, phone normalised, possible-duplicate warning, unique phone/email/VIN/plate enforced by the database |
| 2 | Reception creates a traceable job card | 1 | Passed | `AT-2` — job, inspection, key custody, history and audit in one transaction; one open job per vehicle; mileage-rollback exception |
| 3 | Diagnosis findings and evidence recorded | 1 | Passed | `AT-3` — findings recorded; a DTC alone is refused as proof; submitted reports are locked; no quotation before diagnosis |
| 4 | Quotation generated and approval captured | 1 | Passed | `AT-4` — VAT exclusive and inclusive totals, evidence required, partial approval, versioning on revision, rejection declines, discount limits |
| 5 | Unapproved work blocked unless authorised exception | 1 | Passed | `AT-5` — API refuses; database check refuses a repair task with no approved line; database refuses status jumps; no self-authorisation; exception used once and recorded |
| 6 | Completed repairs require configured QC | 1 | Passed | `AT-6` — open tasks block QC; required checklist steps; only the assignee completes; computed QC outcome; road test; independent inspector; no invoice before QC |
| 7 | Invoice generated from approved work | 1 | Passed | `AT-7` — only approved, completed lines at approved prices; balanced journal; invoices immutable; no double invoicing; diagnosis fee only when management sets it |
| 8 | Partial payments update the balance | 1 | Passed | `AT-8` — cash clears on receipt; transfers wait for a second person; balances and statuses; automatic release when paid; overpayment becomes a deposit; corporate credit release |
| 9 | Cash collected is not confused with revenue | 1 | Passed | `AT-9` — unpaid invoice adds revenue and receivables but no cash; pending transfer adds nothing; ledger reconciliation true |
| 10 | Receivables and overdue calculate accurately | 2 | Groundwork in place | Open balances and Lagos-calendar overdue rule implemented and unit-tested; full ageing tests scheduled with Phase 2 credit control |
| 11 | Users cannot access modules outside their permissions | 1 | Passed | `AT-11` — 10 role/route refusals; ops sees no financial figures; auditor read-only; unauthenticated and cross-site requests refused; role change revokes sessions; lockout. Plus `routes.spec` — every route declares a known permission |
| 12 | Every sensitive financial change is audited | 1 | Passed | `AT-12` — invoice, payment, allocation, clearing, approvals, QC, settings and exceptions all in the trail; append-only; tampering detected at the exact row; secrets never written |
| 13 | Customers see only their own records | 3 | Not started | Customer portal is Phase 3 |
| 14 | Inventory movements reconcile with stock | 4 | Not started | Inventory is Phase 4 |
| 15 | Backups restore and verify | 1 | Passed | `AT-15` — runs `ops/backup.sh` and `ops/restore-verify.sh` against the test database after all other tests |
| 16 | Dashboards reconcile with transactions | 2 | Groundwork in place | Phase 1 summary already reconciles revenue, cash and receivables with the ledger (asserted in AT-9); full dashboard in Phase 2 |

## Test output

```
PASS test/acceptance.spec.ts (6.873 s)
    ✓ registers a customer and vehicle with references
    ✓ flags a possible duplicate (same phone) and blocks an exact duplicate even when confirmed
    ✓ blocks a duplicate plate and a duplicate VIN
    ✓ rejects invalid VINs and phone numbers
    ✓ creates job, inspection, key custody and history in one step
    ✓ allows only one open job per vehicle
    ✓ requires an authorised exception when mileage is below the last record
    ✓ records findings and refuses a DTC as the only proof
    ✓ submits a complete report and moves the job to quotation
    ✓ a quotation cannot be created before the diagnosis is submitted
    ✓ computes VAT-exclusive totals from configured tax, sends, and captures approval with identity
    ✓ computes VAT-inclusive pricing correctly
    ✓ supports partial approval; only approved lines become work
    ✓ a sent quotation cannot be edited; revising issues a new version and requires re-approval
    ✓ a full rejection declines the job
    ✓ a discount above the advisor limit needs an exception authorised by someone else
    ✓ blocks repair before approval
    ✓ the database refuses a repair task with no approved line or exception
    ✓ the database refuses a status jump that skips approval
    ✓ nobody can authorise their own exception
    ✓ an authorised exception lets work start once, and it is recorded
    ✓ cannot go to QC with open tasks; required checklist steps must be done
    ✓ QC outcome is computed: a failed required item sends the job back to repair with a rework task
    ✓ missing road test or unresolved complaint fails QC even if every box is ticked
    ✓ independent QC: the technician who did the repair cannot inspect it
    ✓ invoicing is blocked until QC passes; skipping QC needs an authorised exception
    ✓ bills only approved, completed lines at the approved price, and posts a balanced ledger entry
    ✓ issued invoices cannot be altered or deleted, and a job cannot be invoiced twice
    ✓ a declined job is invoiced only for a diagnosis fee management has set
    ✓ cash clears on receipt; a bank transfer waits for finance; balance and status update; vehicle releases when paid
    ✓ overpayment becomes a customer deposit and is applied to the next invoice
    ✓ segregation of duties: the recorder cannot clear or fail their own payment; references are unique
    ✓ corporate customers on approved credit terms can collect before paying
    ✓ an unpaid invoice adds revenue and receivables but no cash; a pending transfer adds nothing
    ✓ a cleared payment adds cash and reduces receivables without changing revenue
    ✓ diag → post /customers is refused
    ✓ tech → post /payments is refused
    ✓ qc → get /invoices is refused
    ✓ advisor → get /reports/trial-balance is refused
    ✓ advisor → get /audit is refused
    ✓ advisor → get /users is refused
    ✓ accountant → post /reception is refused
    ✓ auditor → post /customers is refused
    ✓ auditor → post /payments is refused
    ✓ ops → post /payments is refused
    ✓ operations manager sees operational KPIs but not financial figures
    ✓ the auditor can read everything financial but change nothing
    ✓ unauthenticated requests and cross-site posts are refused
    ✓ removing a role revokes active sessions immediately
    ✓ locks an account after 5 failed logins
    ✓ records invoice, payment, allocation, clearing, discount exception and settings changes, and the chain verifies
    ✓ the audit trail is append-only and tampering is detected
    ✓ secrets never reach the audit trail
    ✓ the database refuses an unbalanced journal entry
    ✓ invoice numbers are gapless
    ✓ trial balance is balanced after all the activity above
PASS test/routes.spec.ts
    ✓ has @Requires or @Public on every handler
PASS test/unit.spec.ts
    ✓ rounds half up to the kobo
    ✓ tax-exclusive line
    ✓ tax-inclusive line splits net and tax and keeps the gross
    ✓ applies discount before tax
    ✓ zero-rated and exempt lines carry no tax
    ✓ refuses a discount larger than the line
    ✓ 08031234567 → +2348031234567
    ✓ 2348031234567 → +2348031234567
    ✓ +234 803 123 4567 → +2348031234567
    ✓ validates a known-good North American VIN
    ✓ flags a wrong check digit
    ✓ custom ranges include the end date
    ✓ an invoice due today is not overdue
    ✓ an invoice due yesterday is overdue
    ✓ 23:30 Lagos on the due date is still not overdue
PASS test/backup.spec.ts
    ✓ backs up, restores into a scratch database, and verifies integrity and row counts
Tests:       73 passed, 73 total
```
