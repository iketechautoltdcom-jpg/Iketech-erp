'use client';
/** Thin API client. Errors carry the server's stable code and readable message. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/v1${path}`, {
    method, credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'iketech-erp' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined' && !path.startsWith('/auth/')) window.location.href = '/login';
    throw new ApiError(res.status, data.code ?? 'ERROR', data.message ?? 'Request failed', data.details);
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => call<T>('GET', p),
  post: <T = any>(p: string, b: unknown = {}) => call<T>('POST', p, b),
  put: <T = any>(p: string, b: unknown = {}) => call<T>('PUT', p, b),
  patch: <T = any>(p: string, b: unknown = {}) => call<T>('PATCH', p, b),
};

export function errorText(e: unknown): string {
  if (e instanceof ApiError) {
    const extra = e.details?.problems ?? e.details?.missing ?? e.details?.open ?? (Array.isArray(e.details) ? e.details.map((d: any) => `${d.path}: ${d.message}`) : null);
    return extra?.length ? `${e.message}: ${extra.join('; ')}` : e.message;
  }
  return (e as Error)?.message ?? 'Something went wrong';
}

/** Negative amounts (credit balances) print as "₦16,425.00 Cr" rather than "₦-16,425.00". */
export const naira = (kobo: number | null | undefined) => {
  if (kobo == null) return '—';
  const v = Number(kobo) / 100;
  const s = '₦' + Math.abs(v).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return v < 0 ? `${s} Cr` : s;
};
export const lagosDay = (d: string) => new Date(new Date(d).getTime() + 3600000).toISOString().slice(0, 10);

export const when = (d?: string | null) =>
  d ? new Date(d).toLocaleString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
export const day = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const STATUS_LABEL: Record<string, string> = {
  RECEIVED: 'Received', DIAGNOSING: 'Diagnosing', QUOTE_PENDING: 'Quote to prepare', AWAITING_APPROVAL: 'Awaiting approval',
  APPROVED: 'Approved', DECLINED: 'Declined', IN_REPAIR: 'In repair', QC: 'Quality control', READY_TO_INVOICE: 'Ready to invoice',
  INVOICED: 'Invoiced — awaiting payment', READY_FOR_COLLECTION: 'Ready for collection', DELIVERED: 'Delivered', CLOSED: 'Closed',
  ON_HOLD: 'On hold', CANCELLED: 'Cancelled',
};
