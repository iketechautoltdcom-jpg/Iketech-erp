import { z } from 'zod';
export { z };

export const uuid = z.string().uuid();
/** Naira amount entered by a person (e.g. 15000.50) → integer kobo. */
export const naira = z.number().nonnegative().max(9e10).transform((n) => Math.round(n * 100));
export const kobo = z.number().int().nonnegative();

/** Nigerian numbers: 080..., +23480..., 23480... → +23480... */
export function normalizePhone(raw: string): string {
  const d = raw.replace(/[^\d+]/g, '');
  if (d.startsWith('+')) return d;
  if (d.startsWith('234')) return '+' + d;
  if (d.startsWith('0') && d.length === 11) return '+234' + d.slice(1);
  return d;
}
export const phone = z.string().min(7).transform(normalizePhone).refine((v) => /^\+[1-9]\d{7,14}$/.test(v), 'Enter a valid phone number');

export function parse<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data);
}
