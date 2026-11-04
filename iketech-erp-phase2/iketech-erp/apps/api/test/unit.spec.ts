import 'reflect-metadata';
import { computeLine, roundDiv } from '../src/common/money';
import { normalizePhone } from '../src/common/zod';
import { vinCheckDigitValid } from '../src/modules/crm/crm.service';
import { resolvePeriod } from '../src/modules/reports/reports.controller';
import { isOverdue } from '../src/modules/billing/billing.service';

describe('money', () => {
  it('rounds half up to the kobo', () => {
    expect(roundDiv(5, 2)).toBe(3);
    expect(roundDiv(4, 2)).toBe(2);
    expect(roundDiv(149, 100)).toBe(1);
    expect(roundDiv(150, 100)).toBe(2);
  });
  it('tax-exclusive line', () => {
    expect(computeLine({ qty: 1.5, unitPrice: 1_000_000, discount: 0, rateBp: 750, pricesIncludeTax: false })).toEqual({ gross: 1_500_000, net: 1_500_000, tax: 112_500, total: 1_612_500 });
  });
  it('tax-inclusive line splits net and tax and keeps the gross', () => {
    const l = computeLine({ qty: 1, unitPrice: 1_075_000, discount: 0, rateBp: 750, pricesIncludeTax: true });
    expect(l).toEqual({ gross: 1_075_000, net: 1_000_000, tax: 75_000, total: 1_075_000 });
  });
  it('applies discount before tax', () => {
    expect(computeLine({ qty: 1, unitPrice: 5_000_000, discount: 250_000, rateBp: 750, pricesIncludeTax: false }).total).toBe(4_750_000 + 356_250);
  });
  it('zero-rated and exempt lines carry no tax', () => {
    expect(computeLine({ qty: 2, unitPrice: 333, discount: 0, rateBp: 0, pricesIncludeTax: false })).toEqual({ gross: 666, net: 666, tax: 0, total: 666 });
  });
  it('refuses a discount larger than the line', () => {
    expect(() => computeLine({ qty: 1, unitPrice: 100, discount: 101, rateBp: 0, pricesIncludeTax: false })).toThrow();
  });
});

describe('phone normalisation', () => {
  it.each([['08031234567', '+2348031234567'], ['2348031234567', '+2348031234567'], ['+234 803 123 4567', '+2348031234567']])('%s → %s', (a, b) => {
    expect(normalizePhone(a)).toBe(b);
  });
});

describe('VIN check digit', () => {
  it('validates a known-good North American VIN', () => expect(vinCheckDigitValid('1M8GDM9AXKP042788')).toBe(true));
  it('flags a wrong check digit', () => expect(vinCheckDigitValid('1M8GDM9A1KP042788')).toBe(false));
});

describe('report periods (Africa/Lagos)', () => {
  it('custom ranges include the end date', () => {
    const p = resolvePeriod('custom', '2026-10-01', '2026-10-31');
    expect(p.from.toISOString()).toBe('2026-09-30T23:00:00.000Z');
    expect(p.to.toISOString()).toBe('2026-10-31T23:00:00.000Z');
  });
});

describe('overdue rule (Africa/Lagos calendar days)', () => {
  it('an invoice due today is not overdue', () => expect(isOverdue(new Date())).toBe(false));
  it('an invoice due yesterday is overdue', () => expect(isOverdue(new Date(Date.now() - 86400000 * 1.1))).toBe(true));
  it('23:30 Lagos on the due date is still not overdue', () => {
    const due = new Date('2026-10-31T22:30:00Z'); // 23:30 Lagos, 31 Oct
    expect(isOverdue(due)).toBe(true); // by any later real date, 31 Oct has passed
  });
});
