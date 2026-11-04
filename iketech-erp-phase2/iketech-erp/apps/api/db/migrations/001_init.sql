-- IKETECH AUTO ERP — Phase 1 (Core Workshop ERP) schema
-- Conventions: UUID ids, timestamptz (UTC), created_by/updated_by, branch_id on operational rows,
-- money as BIGINT kobo (₦1 = 100 kobo), optimistic locking via "version".
-- Integrity rules are enforced here in the database, not only in application code.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────── Enums ─────────────
CREATE TYPE user_status AS ENUM ('ACTIVE','DISABLED');
CREATE TYPE customer_type AS ENUM ('INDIVIDUAL','CORPORATE');
CREATE TYPE job_status AS ENUM ('RECEIVED','DIAGNOSING','QUOTE_PENDING','AWAITING_APPROVAL','APPROVED','DECLINED',
  'IN_REPAIR','QC','READY_TO_INVOICE','INVOICED','READY_FOR_COLLECTION','DELIVERED','CLOSED','ON_HOLD','CANCELLED');
CREATE TYPE task_kind AS ENUM ('DIAGNOSIS','REPAIR');
CREATE TYPE task_status AS ENUM ('PENDING','IN_PROGRESS','PAUSED','DONE','CANCELLED');
CREATE TYPE report_status AS ENUM ('DRAFT','SUBMITTED');
CREATE TYPE finding_kind AS ENUM ('DTC','FREEZE_FRAME','LIVE_DATA','TEST','MEASUREMENT','OBSERVATION');
CREATE TYPE quotation_status AS ENUM ('DRAFT','SENT','APPROVED','PARTIALLY_APPROVED','REJECTED','SUPERSEDED','EXPIRED');
CREATE TYPE item_kind AS ENUM ('LABOUR','PART','SUBLET','FEE');
CREATE TYPE item_decision AS ENUM ('PENDING','APPROVED','REJECTED');
CREATE TYPE exception_kind AS ENUM ('START_REPAIR_WITHOUT_APPROVAL','SKIP_QC','RELEASE_WITHOUT_PAYMENT','MILEAGE_OVERRIDE','DISCOUNT_ABOVE_LIMIT');
CREATE TYPE exception_status AS ENUM ('PENDING','AUTHORISED','REJECTED','USED','EXPIRED');
CREATE TYPE invoice_status AS ENUM ('ISSUED','PARTIALLY_PAID','PAID','VOID');
CREATE TYPE payment_method AS ENUM ('CASH','BANK_TRANSFER','POS','GATEWAY','CHEQUE');
CREATE TYPE payment_status AS ENUM ('PENDING','CLEARED','FAILED','REVERSED');
CREATE TYPE account_type AS ENUM ('ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE');

-- ───────────── Identity & organisation ─────────────
CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE CHECK (code ~ '^[A-Z]{2,5}$'),
  name text NOT NULL,
  address text,
  timezone text NOT NULL DEFAULT 'Africa/Lagos',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  full_name text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  mfa_secret text,
  status user_status NOT NULL DEFAULT 'ACTIVE',
  failed_logins int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  branch_id uuid NOT NULL REFERENCES branches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);

CREATE TABLE sessions (
  id text PRIMARY KEY, -- sha256 of the opaque token; raw token lives only in the httpOnly cookie
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  ip text,
  user_agent text,
  revoked_at timestamptz
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

CREATE TABLE employees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_no text NOT NULL UNIQUE,
  user_id uuid UNIQUE REFERENCES users(id),
  full_name text NOT NULL,
  department text NOT NULL,
  job_title text NOT NULL,
  grade text,
  branch_id uuid NOT NULL REFERENCES branches(id),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── CRM & vehicles ─────────────
CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE,
  type customer_type NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) > 1),
  company_name text,
  phone_e164 text NOT NULL CHECK (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  email text CHECK (email IS NULL OR email = lower(email)),
  address text,
  tin text,
  credit_limit bigint NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_terms_days int NOT NULL DEFAULT 0 CHECK (payment_terms_days BETWEEN 0 AND 180),
  preferred_channel text NOT NULL DEFAULT 'WHATSAPP' CHECK (preferred_channel IN ('WHATSAPP','SMS','EMAIL','PHONE')),
  consent_service boolean NOT NULL DEFAULT true,
  consent_marketing boolean NOT NULL DEFAULT false,
  branch_id uuid NOT NULL REFERENCES branches(id),
  archived_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  CHECK (type = 'INDIVIDUAL' OR company_name IS NOT NULL)
);
-- No two active customers of the same type share a phone or email
CREATE UNIQUE INDEX customers_phone_uq ON customers(type, phone_e164) WHERE archived_at IS NULL;
CREATE UNIQUE INDEX customers_email_uq ON customers(type, email) WHERE archived_at IS NULL AND email IS NOT NULL;

CREATE TABLE customer_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id),
  name text NOT NULL,
  role text,
  phone_e164 text,
  email text,
  is_approver boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customer_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref text NOT NULL UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  vin text CHECK (vin IS NULL OR vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  plate_no text NOT NULL CHECK (plate_no = upper(plate_no) AND length(plate_no) BETWEEN 3 AND 12),
  make text NOT NULL,
  model text NOT NULL,
  year int CHECK (year IS NULL OR year BETWEEN 1950 AND 2100),
  engine_code text,
  transmission text,
  colour text,
  last_mileage int CHECK (last_mileage IS NULL OR last_mileage >= 0),
  branch_id uuid NOT NULL REFERENCES branches(id),
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE UNIQUE INDEX vehicles_vin_uq ON customer_vehicles(vin) WHERE vin IS NOT NULL;
CREATE UNIQUE INDEX vehicles_plate_active_uq ON customer_vehicles(plate_no) WHERE archived_at IS NULL;

-- ───────────── Workshop ─────────────
CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_no text NOT NULL UNIQUE,
  vehicle_id uuid NOT NULL REFERENCES customer_vehicles(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  status job_status NOT NULL DEFAULT 'RECEIVED',
  hold_from_status job_status,
  repair_category text,
  service_advisor_id uuid NOT NULL REFERENCES users(id),
  supervisor_id uuid REFERENCES users(id),
  diag_technician_id uuid REFERENCES users(id),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  customer_complaint text NOT NULL CHECK (length(trim(customer_complaint)) > 2),
  requested_work text,
  promised_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz,
  closed_at timestamptz,
  mileage_out int,
  follow_up_at timestamptz,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id)
);
CREATE INDEX jobs_branch_status_idx ON jobs(branch_id, status);
-- One open job per vehicle
CREATE UNIQUE INDEX jobs_one_open_per_vehicle ON jobs(vehicle_id)
  WHERE status NOT IN ('CLOSED','CANCELLED','DECLINED','DELIVERED');

CREATE TABLE job_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  from_status job_status,
  to_status job_status NOT NULL,
  reason text,
  exception_id uuid,
  actor_id uuid NOT NULL REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX job_status_history_job_idx ON job_status_history(job_id);

CREATE TABLE vehicle_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES jobs(id),
  mileage_in int NOT NULL CHECK (mileage_in >= 0),
  fuel_level text NOT NULL CHECK (fuel_level IN ('E','1/4','1/2','3/4','F')),
  warning_lights jsonb NOT NULL DEFAULT '[]',
  damage_notes jsonb NOT NULL DEFAULT '[]',
  accessories jsonb NOT NULL DEFAULT '[]',
  checklist jsonb NOT NULL DEFAULT '{}',
  customer_concerns text NOT NULL,
  customer_ack_at timestamptz,
  ack_method text CHECK (ack_method IS NULL OR ack_method IN ('SIGNATURE','OTP','VERBAL_RECORDED')),
  ack_name text,
  mileage_override_exception_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);

CREATE TABLE key_custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  action text NOT NULL CHECK (action IN ('IN','MOVED','OUT')),
  holder_name text,
  location text,
  note text,
  at timestamptz NOT NULL DEFAULT now(),
  actor_id uuid NOT NULL REFERENCES users(id)
);

-- ───────────── Diagnostics ─────────────
CREATE TABLE diagnostic_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  technician_id uuid NOT NULL REFERENCES users(id),
  complaint_verified boolean NOT NULL DEFAULT false,
  tools_used text,
  summary text,
  root_cause text,
  recommended_repair text,
  safety_notes text,
  status report_status NOT NULL DEFAULT 'DRAFT',
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status = 'DRAFT' OR (root_cause IS NOT NULL AND submitted_at IS NOT NULL))
);

CREATE TABLE diagnostic_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES diagnostic_reports(id),
  kind finding_kind NOT NULL,
  code text,
  value text,
  unit text,
  interpretation text,
  is_root_cause boolean NOT NULL DEFAULT false,
  supports_id uuid REFERENCES diagnostic_findings(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  CHECK (kind <> 'DTC' OR code IS NOT NULL)
);

-- ───────────── Quotations & approvals ─────────────
CREATE TABLE quotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_no text NOT NULL,
  version int NOT NULL DEFAULT 1 CHECK (version >= 1),
  job_id uuid NOT NULL REFERENCES jobs(id),
  parent_quote_id uuid REFERENCES quotations(id),
  is_supplementary boolean NOT NULL DEFAULT false,
  status quotation_status NOT NULL DEFAULT 'DRAFT',
  prices_include_tax boolean NOT NULL DEFAULT false,
  valid_until timestamptz NOT NULL,
  approval_deadline timestamptz,
  subtotal bigint NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount_total bigint NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total bigint NOT NULL DEFAULT 0 CHECK (tax_total >= 0),
  total bigint NOT NULL DEFAULT 0 CHECK (total >= 0),
  sent_at timestamptz,
  sent_channel text,
  discount_exception_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  UNIQUE (quote_no, version)
);

CREATE TABLE quotation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id),
  line_no int NOT NULL,
  kind item_kind NOT NULL,
  description text NOT NULL,
  qty numeric(10,2) NOT NULL CHECK (qty > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_code text NOT NULL,
  net_amount bigint NOT NULL CHECK (net_amount >= 0),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0),
  line_total bigint NOT NULL CHECK (line_total = net_amount + tax_amount),
  is_optional boolean NOT NULL DEFAULT false,
  decision item_decision NOT NULL DEFAULT 'PENDING',
  UNIQUE (quotation_id, line_no)
);

CREATE TABLE customer_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quotation_id uuid NOT NULL REFERENCES quotations(id),
  decision text NOT NULL CHECK (decision IN ('APPROVED','REJECTED','PARTIAL')),
  approved_item_ids uuid[] NOT NULL DEFAULT '{}',
  channel text NOT NULL CHECK (channel IN ('IN_PERSON','PHONE','WHATSAPP','EMAIL','PORTAL')),
  approver_name text NOT NULL,
  approver_contact text NOT NULL,
  evidence_note text,
  evidence_file_id uuid,
  ip text,
  recorded_by uuid NOT NULL REFERENCES users(id),
  decided_at timestamptz NOT NULL DEFAULT now(),
  -- Approvals taken outside the portal must carry evidence (who said yes, how)
  CHECK (channel = 'PORTAL' OR evidence_note IS NOT NULL OR evidence_file_id IS NOT NULL)
);

CREATE TABLE approval_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  kind exception_kind NOT NULL,
  reason text NOT NULL CHECK (length(trim(reason)) >= 10),
  limit_amount bigint,
  requested_by uuid NOT NULL REFERENCES users(id),
  authorised_by uuid REFERENCES users(id),
  status exception_status NOT NULL DEFAULT 'PENDING',
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  -- Segregation of duties: nobody authorises their own exception
  CHECK (authorised_by IS NULL OR authorised_by <> requested_by)
);

-- ───────────── Repairs & QC ─────────────
CREATE TABLE job_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  kind task_kind NOT NULL,
  title text NOT NULL,
  quotation_item_id uuid REFERENCES quotation_items(id),
  exception_id uuid REFERENCES approval_exceptions(id),
  assigned_to uuid REFERENCES users(id),
  status task_status NOT NULL DEFAULT 'PENDING',
  started_at timestamptz,
  finished_at timestamptz,
  labour_minutes int NOT NULL DEFAULT 0 CHECK (labour_minutes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  -- A repair task must be backed by an approved quotation line or an authorised exception
  CHECK (kind <> 'REPAIR' OR quotation_item_id IS NOT NULL OR exception_id IS NOT NULL)
);

CREATE TABLE repair_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES job_tasks(id),
  procedure_ref text,
  notes text NOT NULL,
  measurements jsonb NOT NULL DEFAULT '{}',
  parts_used jsonb NOT NULL DEFAULT '[]',
  checklist jsonb NOT NULL DEFAULT '[]',
  completed_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE qc_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repair_category text NOT NULL,
  version int NOT NULL DEFAULT 1,
  requires_independent boolean NOT NULL DEFAULT false,
  requires_road_test boolean NOT NULL DEFAULT false,
  requires_post_scan boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (repair_category, version)
);
CREATE UNIQUE INDEX qc_templates_one_active ON qc_templates(repair_category) WHERE active;

CREATE TABLE qc_template_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES qc_templates(id),
  code text NOT NULL,
  text text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  sort int NOT NULL DEFAULT 0,
  UNIQUE (template_id, code)
);

CREATE TABLE quality_control_inspections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES jobs(id),
  template_id uuid NOT NULL REFERENCES qc_templates(id),
  inspector_id uuid NOT NULL REFERENCES users(id),
  results jsonb NOT NULL,
  road_test_done boolean NOT NULL DEFAULT false,
  road_test_notes text,
  post_scan_clear boolean,
  post_scan_notes text,
  complaint_resolved boolean NOT NULL DEFAULT false,
  outcome text NOT NULL CHECK (outcome IN ('PASS','FAIL')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ───────────── Billing ─────────────
CREATE TABLE invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_no text NOT NULL UNIQUE,
  job_id uuid REFERENCES jobs(id),
  customer_id uuid NOT NULL REFERENCES customers(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  status invoice_status NOT NULL DEFAULT 'ISSUED',
  issue_date timestamptz NOT NULL DEFAULT now(),
  due_date timestamptz NOT NULL,
  currency text NOT NULL DEFAULT 'NGN',
  subtotal bigint NOT NULL CHECK (subtotal >= 0),
  discount_total bigint NOT NULL DEFAULT 0 CHECK (discount_total >= 0),
  tax_total bigint NOT NULL CHECK (tax_total >= 0),
  total bigint NOT NULL CHECK (total >= 0),
  amount_paid bigint NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  balance bigint NOT NULL,
  version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  CHECK (total = subtotal - discount_total + tax_total),
  CHECK (balance = total - amount_paid),
  CHECK (balance >= 0),
  CHECK (due_date >= issue_date - interval '1 day')
);
-- One live invoice per job in Phase 1 (supplementary work is re-quoted before invoicing)
CREATE UNIQUE INDEX invoices_one_per_job ON invoices(job_id) WHERE status <> 'VOID' AND job_id IS NOT NULL;

CREATE TABLE invoice_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  source_quotation_item_id uuid REFERENCES quotation_items(id),
  kind item_kind NOT NULL,
  description text NOT NULL,
  qty numeric(10,2) NOT NULL CHECK (qty > 0),
  unit_price bigint NOT NULL CHECK (unit_price >= 0),
  discount bigint NOT NULL DEFAULT 0 CHECK (discount >= 0),
  tax_code text NOT NULL,
  net_amount bigint NOT NULL CHECK (net_amount >= 0),
  tax_amount bigint NOT NULL CHECK (tax_amount >= 0),
  line_total bigint NOT NULL CHECK (line_total = net_amount + tax_amount)
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text UNIQUE,
  customer_id uuid NOT NULL REFERENCES customers(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  amount bigint NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'NGN',
  method payment_method NOT NULL,
  reference text,
  status payment_status NOT NULL DEFAULT 'PENDING',
  received_at timestamptz NOT NULL DEFAULT now(),
  received_by uuid NOT NULL REFERENCES users(id),
  cleared_at timestamptz,
  cleared_by uuid REFERENCES users(id),
  reversed_by uuid REFERENCES users(id),
  reversal_reason text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (method = 'CASH' OR reference IS NOT NULL),
  CHECK (status <> 'CLEARED' OR (receipt_no IS NOT NULL AND cleared_at IS NOT NULL)),
  -- The person who recorded a payment cannot reverse it
  CHECK (reversed_by IS NULL OR reversed_by <> received_by)
);
CREATE UNIQUE INDEX payments_method_reference_uq ON payments(method, reference) WHERE reference IS NOT NULL;

CREATE TABLE payment_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_id uuid NOT NULL REFERENCES payments(id),
  invoice_id uuid NOT NULL REFERENCES invoices(id),
  amount bigint NOT NULL CHECK (amount > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);

-- ───────────── Ledger ─────────────
CREATE TABLE accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  type account_type NOT NULL
);

CREATE TABLE journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_date timestamptz NOT NULL,
  branch_id uuid NOT NULL REFERENCES branches(id),
  source_type text NOT NULL,
  source_id uuid NOT NULL,
  memo text,
  reverses_id uuid REFERENCES journal_entries(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX journal_entries_source_idx ON journal_entries(source_type, source_id);

CREATE TABLE journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL REFERENCES journal_entries(id),
  account_id uuid NOT NULL REFERENCES accounts(id),
  debit bigint NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit bigint NOT NULL DEFAULT 0 CHECK (credit >= 0),
  customer_id uuid REFERENCES customers(id),
  CHECK ((debit = 0) <> (credit = 0))
);
CREATE INDEX journal_lines_entry_idx ON journal_lines(entry_id);

-- ───────────── Configuration ─────────────
CREATE TABLE tax_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tax_code text NOT NULL CHECK (tax_code ~ '^[A-Z_]{2,20}$'),
  name text NOT NULL,
  rate_bp int NOT NULL CHECK (rate_bp BETWEEN 0 AND 10000), -- basis points; 1 bp = 0.01 %
  effective_from date NOT NULL,
  effective_to date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id),
  CHECK (effective_to IS NULL OR effective_to >= effective_from)
);
-- No overlapping date ranges per tax code
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE tax_configurations ADD CONSTRAINT tax_no_overlap
  EXCLUDE USING gist (tax_code WITH =, daterange(effective_from, coalesce(effective_to, 'infinity'::date), '[]') WITH &&);

CREATE TABLE number_sequences (
  doc_type text NOT NULL,
  scope text NOT NULL,
  next_value int NOT NULL DEFAULT 1 CHECK (next_value >= 1),
  PRIMARY KEY (doc_type, scope)
);

CREATE TABLE settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  description text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id)
);

CREATE TABLE approval_limits (
  role_code text NOT NULL,
  action text NOT NULL,
  max_value bigint NOT NULL CHECK (max_value >= 0),
  PRIMARY KEY (role_code, action)
);

-- ───────────── Cross-cutting ─────────────
CREATE TABLE attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type text NOT NULL,
  owner_id uuid NOT NULL,
  storage_key text NOT NULL UNIQUE,
  file_name text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL CHECK (size > 0 AND size <= 52428800),
  sha256 text NOT NULL,
  visibility text NOT NULL DEFAULT 'INTERNAL' CHECK (visibility IN ('INTERNAL','CUSTOMER')),
  caption text,
  branch_id uuid NOT NULL REFERENCES branches(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id)
);
CREATE INDEX attachments_owner_idx ON attachments(owner_type, owner_id);

CREATE TABLE audit_logs (
  seq bigserial PRIMARY KEY,
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  actor_id uuid,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id text,
  before jsonb,
  after jsonb,
  ip text,
  branch_id uuid,
  at timestamptz NOT NULL DEFAULT now(),
  prev_hash text NOT NULL,
  hash text NOT NULL UNIQUE
);
CREATE INDEX audit_logs_entity_idx ON audit_logs(entity, entity_id);
