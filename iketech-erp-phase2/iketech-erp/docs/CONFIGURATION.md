# Configuration reference

Roles, permissions, settings and QC templates as seeded. All are data: management can change them under Administration (every change is audited).

## Role permissions

✓ = granted. Procurement and Inventory roles get their permissions with Phase 4.

| Permission | CEO | OPS_MANAGER | SERVICE_ADVISOR | DIAG_TECH | REPAIR_TECH | QC_INSPECTOR | ACCOUNTANT | PROCUREMENT | INVENTORY | AUDITOR |
| --- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| View customers and vehicles (`customers.read`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |
| Register and edit customers and vehicles (`customers.write`) | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| Receive vehicles and open job cards (`reception.create`) | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| View job cards (`jobs.read`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  | ✓ |
| Assign technicians and supervisors (`jobs.assign`) | ✓ | ✓ |  |  |  |  |  |  |  |  |
| Move jobs through service-advisor steps (`jobs.advance`) | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| Put jobs on hold, resume or cancel them (`jobs.hold`) | ✓ | ✓ |  |  |  |  |  |  |  |  |
| View diagnostic reports (`diagnostics.read`) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |  |  |  | ✓ |
| Write and submit diagnostic reports (`diagnostics.write`) | ✓ |  |  | ✓ |  |  |  |  |  |  |
| View quotations (`quotations.read`) | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ |
| Create, revise and send quotations (`quotations.write`) | ✓ |  | ✓ |  |  |  |  |  |  |  |
| Record customer approval or rejection (`quotations.record_approval`) | ✓ |  | ✓ |  |  |  |  |  |  |  |
| Request a gate exception (`exceptions.request`) | ✓ | ✓ | ✓ |  |  |  |  |  |  |  |
| Authorise or reject gate exceptions (`exceptions.authorise`) | ✓ | ✓ |  |  |  |  |  |  |  |  |
| Work repair tasks and record repairs (`repairs.write`) | ✓ |  |  |  | ✓ |  |  |  |  |  |
| Carry out quality-control inspections (`qc.inspect`) | ✓ |  |  |  |  | ✓ |  |  |  |  |
| View invoices (`invoices.read`) | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ |
| Issue invoices from completed work (`invoices.create`) | ✓ |  | ✓ |  |  |  | ✓ |  |  |  |
| View payments and receipts (`payments.read`) | ✓ | ✓ | ✓ |  |  |  | ✓ |  |  | ✓ |
| Record payments received (`payments.record`) | ✓ |  | ✓ |  |  |  | ✓ |  |  |  |
| Confirm (clear) bank, POS and cheque payments (`payments.clear`) | ✓ |  |  |  |  |  | ✓ |  |  |  |
| Mark payments failed or reverse unallocated payments (`payments.reverse`) | ✓ |  |  |  |  |  | ✓ |  |  |  |
| View operational reports (`reports.operational`) | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ |
| View financial reports (`reports.financial`) | ✓ |  |  |  |  |  | ✓ |  |  | ✓ |
| Manage users and roles (`users.manage`) | ✓ |  |  |  |  |  |  |  |  |  |
| Manage settings, tax configuration and limits (`settings.manage`) | ✓ |  |  |  |  |  |  |  |  |  |
| View and verify the audit trail (`audit.read`) | ✓ | ✓ |  |  |  |  | ✓ |  |  | ✓ |

Segregation of duties is enforced in code and by database checks: nobody authorises their own exception; the person who records a non-cash payment cannot confirm it; the recorder cannot fail or reverse it; independent QC categories cannot be inspected by anyone who worked on the job; a user cannot remove their own administrator role or disable their own account.

## Settings

| Key | Default | Meaning |
| --- | --- | --- |
| `quotation.validity_days` | `7` | Days a quotation stays valid |
| `quotation.approval_deadline_hours` | `48` | Hours the customer has to decide before the advisor is alerted |
| `exception.default_expiry_hours` | `24` | Hours an authorised gate exception stays usable |
| `diagnosis.fee_on_decline` | `true` | Invoice a diagnosis fee when the customer declines the repair |
| `diagnosis.fee_kobo` | `null` | Diagnosis fee in kobo (must be set by management before it can be invoiced) |
| `diagnosis.fee_tax_code` | `"VAT_STANDARD"` | Tax code applied to the diagnosis fee |
| `followup.days_after_delivery` | `3` | Days after delivery that the follow-up call is due |
| `tax.confirmed_by_adviser` | `false` | Set true only after a Nigerian tax professional has confirmed the tax configuration |
| `qc.default_category` | `"GENERAL"` | QC template used when a job has no repair category |

## QC templates (starter versions)

### general

Independent inspector: no · road test: no · post-repair scan: no

- Work done matches the approved quotation lines
- No fluid leaks at areas worked on
- Fasteners and clamps at worked areas secured
- No new warning lights on the dashboard
- Vehicle interior and exterior left clean; protective covers removed
- Replaced parts tagged and kept for the customer unless they declined

### service

Independent inspector: no · road test: no · post-repair scan: no

- Work done matches the approved quotation lines
- Engine oil, coolant, brake and washer fluid at correct levels
- Filters replaced as quoted and housings sealed
- No leaks after engine run
- Service indicator reset and next-service sticker fitted
- Vehicle left clean; protective covers removed

### brakes

Independent inspector: yes · road test: yes · post-repair scan: no

- Work done matches the approved quotation lines
- Caliper and wheel fasteners torqued to specification
- Brake fluid level correct and system bled; no air in the pedal
- Pedal height and feel correct; parking brake holds
- No leaks at lines, hoses or calipers
- ABS warning light off

### steering suspension

Independent inspector: yes · road test: yes · post-repair scan: no

- Work done matches the approved quotation lines
- Suspension and steering fasteners torqued to specification
- No free play in steering or worked joints
- Alignment checked or customer advised if not quoted
- No knocks or noises over bumps on road test

### engine

Independent inspector: yes · road test: yes · post-repair scan: yes

- Work done matches the approved quotation lines
- Engine starts and idles smoothly
- No oil, coolant or fuel leaks after warm-up
- Operating temperature normal; fan operates
- No stored or pending fault codes after repair

### transmission

Independent inspector: yes · road test: yes · post-repair scan: yes

- Work done matches the approved quotation lines
- Transmission fluid at correct level and grade
- All gears engage; shifts smooth without slip or flare
- No leaks at pan, seals or lines
- No transmission fault codes after repair

### electrical safety

Independent inspector: yes · road test: yes · post-repair scan: yes

- Work done matches the approved quotation lines
- Repaired circuits protected with correct fuse rating
- Wiring routed, insulated and secured away from heat and moving parts
- Airbag, ABS, lighting and other affected safety systems function
- No stored or pending fault codes after repair

### electrical

Independent inspector: no · road test: no · post-repair scan: yes

- Work done matches the approved quotation lines
- Repaired circuits protected with correct fuse rating
- Wiring routed, insulated and secured
- Repaired system operates as specified
- Battery and charging voltage within specification

