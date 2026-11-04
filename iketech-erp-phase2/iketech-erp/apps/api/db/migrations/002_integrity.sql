-- Integrity triggers: the database refuses changes that would break the business rules,
-- even if application code has a bug or someone writes SQL by hand.

-- ───────────── Append-only tables ─────────────
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY: % rows cannot be %d', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'check_violation';
END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['audit_logs','job_status_history','customer_approvals','key_custody_events',
                           'journal_entries','journal_lines','payment_allocations'] LOOP
    EXECUTE format('CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION forbid_change()', t, t);
  END LOOP;
END $$;

-- ───────────── Tamper-evident audit log (hash chain) ─────────────
CREATE FUNCTION audit_hash_chain() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_hash text;
BEGIN
  PERFORM pg_advisory_xact_lock(727274); -- serialise writers so the chain has no forks
  SELECT hash INTO last_hash FROM audit_logs ORDER BY seq DESC LIMIT 1;
  NEW.prev_hash := coalesce(last_hash, 'GENESIS');
  NEW.at := coalesce(NEW.at, now());
  NEW.hash := encode(digest(
    NEW.prev_hash || '|' || NEW.id::text || '|' || coalesce(NEW.actor_id::text,'') || '|' || NEW.action || '|' ||
    NEW.entity || '|' || coalesce(NEW.entity_id,'') || '|' || coalesce(NEW.before::text,'') || '|' ||
    coalesce(NEW.after::text,'') || '|' || to_char(NEW.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
    'sha256'), 'hex');
  RETURN NEW;
END $$;
CREATE TRIGGER audit_logs_hash BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_hash_chain();

-- Returns the first broken row (seq) or NULL when the whole chain verifies.
CREATE FUNCTION audit_verify() RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE r record; prev text := 'GENESIS'; expected text;
BEGIN
  FOR r IN SELECT * FROM audit_logs ORDER BY seq LOOP
    expected := encode(digest(
      prev || '|' || r.id::text || '|' || coalesce(r.actor_id::text,'') || '|' || r.action || '|' ||
      r.entity || '|' || coalesce(r.entity_id,'') || '|' || coalesce(r.before::text,'') || '|' ||
      coalesce(r.after::text,'') || '|' || to_char(r.at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US'),
      'sha256'), 'hex');
    IF r.prev_hash <> prev OR r.hash <> expected THEN RETURN r.seq; END IF;
    prev := r.hash;
  END LOOP;
  RETURN NULL;
END $$;

-- ───────────── Balanced journal entries ─────────────
CREATE FUNCTION journal_must_balance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint; n int;
BEGIN
  SELECT coalesce(sum(debit),0), coalesce(sum(credit),0), count(*) INTO d, c, n
    FROM journal_lines WHERE entry_id = NEW.entry_id;
  IF n < 2 OR d <> c THEN
    RAISE EXCEPTION 'UNBALANCED_JOURNAL: entry % has debits % and credits % over % lines', NEW.entry_id, d, c, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_lines_balance AFTER INSERT ON journal_lines
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION journal_must_balance();

-- ───────────── Job state machine (defence in depth; the API checks roles and conditions) ─────────────
CREATE FUNCTION job_transition_allowed(f job_status, t job_status) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (f, t) IN (
    ('RECEIVED','DIAGNOSING'),
    ('DIAGNOSING','QUOTE_PENDING'),
    ('QUOTE_PENDING','AWAITING_APPROVAL'),
    ('AWAITING_APPROVAL','APPROVED'),
    ('AWAITING_APPROVAL','DECLINED'),
    ('AWAITING_APPROVAL','QUOTE_PENDING'),          -- quotation revised before decision
    ('APPROVED','IN_REPAIR'),
    ('IN_REPAIR','AWAITING_APPROVAL'),              -- supplementary quotation
    ('IN_REPAIR','QC'),
    ('QC','IN_REPAIR'),                             -- QC failed, rework
    ('QC','READY_TO_INVOICE'),
    ('READY_TO_INVOICE','INVOICED'),
    ('DECLINED','INVOICED'),                        -- diagnosis fee when the customer declines
    ('DECLINED','CLOSED'),
    ('INVOICED','READY_FOR_COLLECTION'),
    ('READY_FOR_COLLECTION','DELIVERED'),
    ('DELIVERED','CLOSED'),
    ('RECEIVED','IN_REPAIR'), ('DIAGNOSING','IN_REPAIR'), ('QUOTE_PENDING','IN_REPAIR'), ('AWAITING_APPROVAL','IN_REPAIR'), -- only with START_REPAIR exception
    ('IN_REPAIR','READY_TO_INVOICE')               -- only with SKIP_QC exception
  ) OR (t IN ('ON_HOLD','CANCELLED') AND f NOT IN ('DELIVERED','CLOSED','CANCELLED','ON_HOLD'))
    OR f = 'ON_HOLD';                              -- resume returns to the state held from (checked by API)
$$;

CREATE FUNCTION jobs_check_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT job_transition_allowed(OLD.status, NEW.status) THEN
    RAISE EXCEPTION 'INVALID_TRANSITION: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER jobs_transition BEFORE UPDATE ON jobs FOR EACH ROW EXECUTE FUNCTION jobs_check_transition();

-- ───────────── Issued invoices are immutable (corrections by credit note in Phase 2) ─────────────
CREATE FUNCTION invoices_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE: invoices are never deleted; void instead' USING ERRCODE = 'check_violation';
  END IF;
  IF (NEW.invoice_no, NEW.customer_id, NEW.job_id, NEW.subtotal, NEW.discount_total, NEW.tax_total, NEW.total, NEW.issue_date, NEW.due_date, NEW.currency)
     IS DISTINCT FROM
     (OLD.invoice_no, OLD.customer_id, OLD.job_id, OLD.subtotal, OLD.discount_total, OLD.tax_total, OLD.total, OLD.issue_date, OLD.due_date, OLD.currency) THEN
    RAISE EXCEPTION 'INVOICE_IMMUTABLE: only payment status and balance may change' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoices_immutable BEFORE UPDATE OR DELETE ON invoices FOR EACH ROW EXECUTE FUNCTION invoices_immutable();
CREATE TRIGGER invoice_items_append_only BEFORE UPDATE OR DELETE ON invoice_items FOR EACH ROW EXECUTE FUNCTION forbid_change();

-- ───────────── Sent quotations cannot be edited (a new version is issued instead) ─────────────
CREATE FUNCTION quotation_items_lock() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st quotation_status;
BEGIN
  SELECT status INTO st FROM quotations WHERE id = coalesce(NEW.quotation_id, OLD.quotation_id);
  IF st <> 'DRAFT' THEN
    IF TG_OP = 'UPDATE' AND (to_jsonb(NEW) - 'decision') = (to_jsonb(OLD) - 'decision') THEN
      RETURN NEW; -- recording the customer's decision is allowed
    END IF;
    RAISE EXCEPTION 'QUOTATION_LOCKED: quotation is % — issue a new version', st USING ERRCODE = 'check_violation';
  END IF;
  RETURN coalesce(NEW, OLD);
END $$;
CREATE TRIGGER quotation_items_lock BEFORE INSERT OR UPDATE OR DELETE ON quotation_items FOR EACH ROW EXECUTE FUNCTION quotation_items_lock();

-- ───────────── Payment allocations only from cleared money, never over-allocated ─────────────
CREATE FUNCTION allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE p record; allocated bigint;
BEGIN
  SELECT * INTO p FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF p.status <> 'CLEARED' THEN
    RAISE EXCEPTION 'PAYMENT_NOT_CLEARED: only cleared payments can be allocated' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount),0) INTO allocated FROM payment_allocations WHERE payment_id = NEW.payment_id;
  IF allocated + NEW.amount > p.amount THEN
    RAISE EXCEPTION 'OVER_ALLOCATED: payment % has % kobo, % already allocated', p.id, p.amount, allocated
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payment_allocations_guard BEFORE INSERT ON payment_allocations FOR EACH ROW EXECUTE FUNCTION allocation_guard();

-- Payments are never deleted
CREATE TRIGGER payments_no_delete BEFORE DELETE ON payments FOR EACH ROW EXECUTE FUNCTION forbid_change();
