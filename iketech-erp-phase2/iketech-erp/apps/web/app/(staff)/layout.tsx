'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SessionProvider, useSession } from '@/lib/session';
import { api } from '@/lib/api';
import { useLoad } from '@/components/ui';

function Nav() {
  const path = usePathname();
  const { me, can } = useSession();
  const pending = useLoad(() => (can('exceptions.authorise') ? api.get<any[]>('/exceptions/pending') : Promise.resolve([])), [me?.id]);
  const items: [string, string, boolean, number?][] = [
    ['/', 'Job board', can('jobs.read')],
    ['/reception', 'Receive vehicle', can('reception.create')],
    ['/customers', 'Customers', can('customers.read')],
    ['/invoices', 'Invoices', can('invoices.read')],
    ['/payments', 'Payments', can('payments.read')],
    ['/approvals', 'Approvals', can('exceptions.authorise'), pending.data?.length],
    ['/reports', 'Reports', can('reports.operational', 'reports.financial')],
    ['/admin', 'Administration', can('users.manage', 'audit.read')],
  ];
  return (
    <nav className="side" aria-label="Main">
      <div className="brand"><b>IKETECH AUTO</b><span>Workshop ERP · Port Harcourt</span></div>
      {items.filter((i) => i[2]).map(([href, label, , badge]) => (
        <Link key={href} href={href} className={(href === '/' ? path === '/' || path.startsWith('/jobs') : path.startsWith(href)) ? 'on' : ''}>
          {label}{badge ? <span className="badge">{badge}</span> : null}
        </Link>
      ))}
      {me && (
        <div className="who">
          <b>{me.fullName}</b>{me.roles.join(', ').replace(/_/g, ' ').toLowerCase()}
          <div><button className="link" onClick={async () => { await api.post('/auth/logout'); window.location.href = '/login'; }}>Sign out</button></div>
        </div>
      )}
    </nav>
  );
}

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <div className="shell"><Nav /><main className="main">{children}</main></div>
    </SessionProvider>
  );
}
