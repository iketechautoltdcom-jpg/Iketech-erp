/**
 * Permission catalogue and default role grants (Blueprint Section 5).
 * Seeded into roles / permissions / role_permissions; management can change grants later as data.
 */
export const PERMISSIONS = {
  'customers.read': 'View customers and vehicles',
  'customers.write': 'Register and edit customers and vehicles',
  'reception.create': 'Receive vehicles and open job cards',
  'jobs.read': 'View job cards',
  'jobs.assign': 'Assign technicians and supervisors',
  'jobs.advance': 'Move jobs through service-advisor steps',
  'jobs.hold': 'Put jobs on hold, resume or cancel them',
  'diagnostics.read': 'View diagnostic reports',
  'diagnostics.write': 'Write and submit diagnostic reports',
  'quotations.read': 'View quotations',
  'quotations.write': 'Create, revise and send quotations',
  'quotations.record_approval': 'Record customer approval or rejection',
  'exceptions.request': 'Request a gate exception',
  'exceptions.authorise': 'Authorise or reject gate exceptions',
  'repairs.write': 'Work repair tasks and record repairs',
  'qc.inspect': 'Carry out quality-control inspections',
  'invoices.read': 'View invoices',
  'invoices.create': 'Issue invoices from completed work',
  'payments.read': 'View payments and receipts',
  'payments.record': 'Record payments received',
  'payments.clear': 'Confirm (clear) bank, POS and cheque payments',
  'payments.reverse': 'Mark payments failed or reverse unallocated payments',
  'reports.operational': 'View operational reports',
  'reports.financial': 'View financial reports',
  'users.manage': 'Manage users and roles',
  'settings.manage': 'Manage settings, tax configuration and limits',
  'audit.read': 'View and verify the audit trail',
} as const;
export type Permission = keyof typeof PERMISSIONS;

const ALL = Object.keys(PERMISSIONS) as Permission[];
const READS = ALL.filter((p) => p.endsWith('.read') || p.startsWith('reports.'));

export const ROLES: Record<string, { name: string; permissions: Permission[] }> = {
  CEO: { name: 'CEO / Super Administrator', permissions: ALL },
  OPS_MANAGER: {
    name: 'Operations Manager',
    permissions: ['customers.read', 'customers.write', 'reception.create', 'jobs.read', 'jobs.assign', 'jobs.advance', 'jobs.hold',
      'diagnostics.read', 'quotations.read', 'exceptions.request', 'exceptions.authorise', 'invoices.read', 'payments.read',
      'reports.operational', 'audit.read'],
  },
  SERVICE_ADVISOR: {
    name: 'Service Advisor / Reception',
    permissions: ['customers.read', 'customers.write', 'reception.create', 'jobs.read', 'jobs.advance', 'diagnostics.read',
      'quotations.read', 'quotations.write', 'quotations.record_approval', 'exceptions.request', 'invoices.read',
      'invoices.create', 'payments.read', 'payments.record'],
  },
  DIAG_TECH: { name: 'Diagnostic Technician', permissions: ['customers.read', 'jobs.read', 'diagnostics.read', 'diagnostics.write'] },
  REPAIR_TECH: { name: 'Repair Technician', permissions: ['customers.read', 'jobs.read', 'diagnostics.read', 'repairs.write'] },
  QC_INSPECTOR: { name: 'Quality Control Inspector', permissions: ['customers.read', 'jobs.read', 'diagnostics.read', 'qc.inspect'] },
  ACCOUNTANT: {
    name: 'Accountant / Finance Officer',
    permissions: ['customers.read', 'jobs.read', 'quotations.read', 'invoices.read', 'invoices.create', 'payments.read',
      'payments.record', 'payments.clear', 'payments.reverse', 'reports.financial', 'reports.operational', 'audit.read'],
  },
  PROCUREMENT: { name: 'Procurement Officer', permissions: [] }, // Phase 4 modules
  INVENTORY: { name: 'Inventory Officer', permissions: [] }, // Phase 4 modules
  AUDITOR: { name: 'Read-only Auditor', permissions: [...READS, 'audit.read'] },
};

/** Roles that must use MFA once enrolment ships (Phase 2). */
export const MFA_REQUIRED_ROLES = ['CEO', 'OPS_MANAGER', 'ACCOUNTANT'];
