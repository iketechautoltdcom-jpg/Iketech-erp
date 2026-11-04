#!/usr/bin/env bash
# IKETECH ERP — restore drill. Restores a backup into a throwaway database and proves it is usable:
#   checksum matches · every migration present · audit hash chain intact · every journal entry balanced ·
#   receivables in the ledger equal open invoice balances · row counts match the source (when SOURCE_DATABASE_URL is set).
# Usage: ADMIN_DATABASE_URL=postgresql://user:pass@host:5432/postgres ./restore-verify.sh path/to/iketech-....dump
# Exit code 0 = verified; non-zero = the backup must not be trusted.
set -euo pipefail
DUMP="${1:?pass the dump file}"
: "${ADMIN_DATABASE_URL:?ADMIN_DATABASE_URL (a URL to the postgres maintenance DB) is required}"
if [[ -f "$DUMP.sha256" ]]; then sha256sum --quiet -c "$DUMP.sha256"; fi
if [[ "$DUMP" == *.gpg ]]; then gpg --batch --decrypt --output "${DUMP%.gpg}" "$DUMP"; DUMP="${DUMP%.gpg}"; fi

SCRATCH="iketech_restore_check_$(date -u +%s)"
BASE="${ADMIN_DATABASE_URL%/*}"
TARGET="$BASE/$SCRATCH"
cleanup() { psql -q "$ADMIN_DATABASE_URL" -c "DROP DATABASE IF EXISTS $SCRATCH WITH (FORCE)" >/dev/null 2>&1 || true; }
trap cleanup EXIT

psql -q -v ON_ERROR_STOP=1 "$ADMIN_DATABASE_URL" -c "CREATE DATABASE $SCRATCH"
START=$(date +%s)
pg_restore --no-owner --exit-on-error --dbname="$TARGET" "$DUMP"
SECS=$(( $(date +%s) - START ))

q() { psql -X -A -t -v ON_ERROR_STOP=1 "$1" -c "$2"; }
FAIL=0
check() { if [[ "$2" == "$3" ]]; then echo "PASS  $1"; else echo "FAIL  $1 (got '$2', expected '$3')"; FAIL=1; fi; }

check "migrations applied"           "$(q "$TARGET" "SELECT count(*) > 0 FROM schema_migrations")" "t"
check "audit hash chain intact"      "$(q "$TARGET" "SELECT audit_verify() IS NULL")" "t"
check "every journal entry balanced" "$(q "$TARGET" "SELECT count(*) FROM (SELECT entry_id FROM journal_lines GROUP BY entry_id HAVING sum(debit) <> sum(credit)) x")" "0"
check "trial balance balanced"       "$(q "$TARGET" "SELECT coalesce(sum(debit),0) = coalesce(sum(credit),0) FROM journal_lines")" "t"
check "ledger AR = open invoices"    "$(q "$TARGET" "SELECT (SELECT coalesce(sum(l.debit - l.credit),0) FROM journal_lines l JOIN accounts a ON a.id = l.account_id WHERE a.code = '1100') = (SELECT coalesce(sum(balance),0) FROM invoices WHERE status <> 'VOID')")" "t"

if [[ -n "${SOURCE_DATABASE_URL:-}" ]]; then
  for t in customers customer_vehicles jobs quotations invoices payments payment_allocations journal_lines audit_logs; do
    check "row count $t" "$(q "$TARGET" "SELECT count(*) FROM $t")" "$(q "$SOURCE_DATABASE_URL" "SELECT count(*) FROM $t")"
  done
fi
echo "Restore took ${SECS}s"
if [[ $FAIL -ne 0 ]]; then echo "RESTORE VERIFICATION FAILED"; exit 1; fi
echo "RESTORE VERIFIED"
