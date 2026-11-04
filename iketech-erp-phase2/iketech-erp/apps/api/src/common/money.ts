/**
 * Money is integer kobo. Quantities have 2 decimals and are converted to hundredths to stay in integers.
 * Rounding is half-up to the nearest kobo, applied once per line.
 */
export function roundDiv(n: number, d: number): number {
  const q = Math.floor(n / d);
  const r = n - q * d;
  return r * 2 >= d ? q + 1 : q;
}

export interface LineInput { qty: number; unitPrice: number; discount: number; rateBp: number; pricesIncludeTax: boolean }
export interface LineAmounts { gross: number; net: number; tax: number; total: number }

export function computeLine({ qty, unitPrice, discount, rateBp, pricesIncludeTax }: LineInput): LineAmounts {
  const qtyHundredths = Math.round(qty * 100);
  const gross = roundDiv(unitPrice * qtyHundredths, 100);
  if (discount > gross) throw new Error('Discount cannot exceed the line amount');
  const afterDiscount = gross - discount;
  if (pricesIncludeTax) {
    const net = roundDiv(afterDiscount * 10000, 10000 + rateBp);
    return { gross, net, tax: afterDiscount - net, total: afterDiscount };
  }
  const tax = roundDiv(afterDiscount * rateBp, 10000);
  return { gross, net: afterDiscount, tax, total: afterDiscount + tax };
}

export const formatNaira = (kobo: number) =>
  '₦' + (kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
