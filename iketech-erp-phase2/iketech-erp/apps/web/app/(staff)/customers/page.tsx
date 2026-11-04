'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, naira } from '@/lib/api';
import { useLoad, Msg, Empty } from '@/components/ui';

export default function Customers() {
  const [q, setQ] = useState('');
  const list = useLoad(() => api.get<any[]>(`/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);
  return (
    <>
      <div className="pagehead"><div><h1>Customers</h1><p>Search by name, phone, plate or VIN.</p></div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" style={{ width: 300 }} aria-label="Search customers" /></div>
      <Msg error={list.error} />
      <section className="panel">
        {list.data?.length ? (
          <table><thead><tr><th>Customer</th><th>Ref</th><th>Phone</th><th className="r">Vehicles</th><th className="r">Owes</th></tr></thead><tbody>{list.data.map((c) => (
            <tr key={c.id} className="click" onClick={() => (location.href = `/customers/${c.id}`)}>
              <td><Link href={`/customers/${c.id}`}><b>{c.name}</b></Link>{c.company_name && <div className="small muted">{c.company_name}</div>}</td>
              <td className="num small">{c.ref}</td><td className="small">{c.phone_e164}</td><td className="r num">{c.vehicle_count}</td><td className="r num">{Number(c.outstanding) ? naira(c.outstanding) : ''}</td>
            </tr>
          ))}</tbody></table>
        ) : <Empty>{q ? 'No customer matches that search.' : 'No customers yet. They are registered when a vehicle is received.'}</Empty>}
      </section>
    </>
  );
}
