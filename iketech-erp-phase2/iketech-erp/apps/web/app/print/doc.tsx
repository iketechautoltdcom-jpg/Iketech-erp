'use client';
import { ReactNode } from 'react';
import { naira } from '@/lib/api';

export function DocShell({ title, number, children, meta }: { title: string; number: string; children: ReactNode; meta: [string, ReactNode][] }) {
  return (
    <main style={{ padding: 24, background: '#fff', minHeight: '100vh' }}>
      <div className="noprint row" style={{ maxWidth: 820, margin: '0 auto 16px' }}><button className="primary" onClick={() => window.print()}>Print or save as PDF</button></div>
      <article className="doc">
        <header>
          <div className="co"><b>IKETECH AUTO LTD</b><span className="small muted">Automotive diagnostics, electrical and mechanical repairs<br />Port Harcourt, Rivers State, Nigeria</span></div>
          <div style={{ textAlign: 'right' }}><h1 style={{ fontSize: 24 }}>{title}</h1><div className="num"><b>{number}</b></div></div>
        </header>
        <dl className="facts" style={{ marginBottom: 20 }}>{meta.map(([k, v]) => <span key={k} style={{ display: 'contents' }}><dt>{k}</dt><dd>{v}</dd></span>)}</dl>
        {children}
      </article>
    </main>
  );
}

export function Lines({ items, totals }: { items: any[]; totals: { subtotal: number; discount: number; tax: number; total: number } }) {
  return (
    <table>
      <thead><tr><th>Description</th><th className="r">Qty</th><th className="r">Unit price</th><th className="r">Discount</th><th className="r">VAT</th><th className="r">Amount</th></tr></thead>
      <tbody>{items.map((i) => (
        <tr key={i.id}><td>{i.description}</td><td className="r num">{i.qty}</td><td className="r num">{naira(i.unit_price)}</td><td className="r num">{i.discount ? naira(i.discount) : ''}</td><td className="r num">{naira(i.tax_amount)}</td><td className="r num">{naira(i.line_total)}</td></tr>
      ))}</tbody>
      <tfoot>
        <tr><td colSpan={5} className="r">Subtotal</td><td className="r num">{naira(totals.subtotal)}</td></tr>
        {totals.discount > 0 && <tr><td colSpan={5} className="r">Discount</td><td className="r num">−{naira(totals.discount)}</td></tr>}
        <tr><td colSpan={5} className="r">VAT</td><td className="r num">{naira(totals.tax)}</td></tr>
        <tr><td colSpan={5} className="r" style={{ fontSize: 17 }}>Total</td><td className="r num" style={{ fontSize: 17 }}>{naira(totals.total)}</td></tr>
      </tfoot>
    </table>
  );
}
