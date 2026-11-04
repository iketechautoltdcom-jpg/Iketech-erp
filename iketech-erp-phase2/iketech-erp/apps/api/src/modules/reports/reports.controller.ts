import { Controller, Get, Query } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { AuthUser, CurrentUser, Requires } from '../../auth/decorators';
import { DomainError } from '../../common/errors';

/** Period presets in Africa/Lagos (UTC+1, no DST). */
export function resolvePeriod(period = 'today', fromQ?: string, toQ?: string) {
  const LAGOS = 3600000;
  const nowLocal = new Date(Date.now() + LAGOS);
  const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - LAGOS);
  const today = startOfDay(nowLocal);
  const y = nowLocal.getUTCFullYear(), m = nowLocal.getUTCMonth();
  switch (period) {
    case 'today': return { from: today, to: new Date(today.getTime() + 86400000) };
    case 'week': { const dow = (nowLocal.getUTCDay() + 6) % 7; const f = new Date(today.getTime() - dow * 86400000); return { from: f, to: new Date(f.getTime() + 7 * 86400000) }; }
    case 'month': return { from: new Date(Date.UTC(y, m, 1) - LAGOS), to: new Date(Date.UTC(y, m + 1, 1) - LAGOS) };
    case 'quarter': { const q = Math.floor(m / 3) * 3; return { from: new Date(Date.UTC(y, q, 1) - LAGOS), to: new Date(Date.UTC(y, q + 3, 1) - LAGOS) }; }
    case 'year': return { from: new Date(Date.UTC(y, 0, 1) - LAGOS), to: new Date(Date.UTC(y + 1, 0, 1) - LAGOS) };
    case 'custom': {
      const from = new Date(`${fromQ}T00:00:00+01:00`), to = new Date(`${toQ}T00:00:00+01:00`);
      if (isNaN(+from) || isNaN(+to) || to <= from) throw new DomainError('INVALID_PERIOD', 'Give from and to as YYYY-MM-DD with to after from', 400);
      return { from, to: new Date(to.getTime() + 86400000) };
    }
    default: throw new DomainError('INVALID_PERIOD', 'period must be today, week, month, quarter, year or custom', 400);
  }
}

@Controller('reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Requires('reports.operational', 'reports.financial') @Get('summary')
  async summary(@CurrentUser() u: AuthUser, @Query('period') period?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const p = resolvePeriod(period, from, to);
    const s = await this.reports.summary(u.branchId, p.from, p.to);
    // Operations managers see operational KPIs only; financial figures need reports.financial.
    if (!u.permissions.has('reports.financial')) return { period: s.period, operations: s.operations };
    return s;
  }

  @Requires('reports.financial') @Get('trial-balance')
  trialBalance(@CurrentUser() u: AuthUser) { return this.reports.trialBalance(u.branchId); }
}
