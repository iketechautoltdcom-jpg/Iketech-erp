-- A payment recorded against a specific invoice keeps that target until it clears.
ALTER TABLE payments ADD COLUMN intended_invoice_id uuid REFERENCES invoices(id);
-- Clearing must be done by someone other than the person who recorded the payment (cash is cleared on receipt).
ALTER TABLE payments ADD CONSTRAINT payments_clear_sod CHECK (method = 'CASH' OR cleared_by IS NULL OR cleared_by <> received_by);
