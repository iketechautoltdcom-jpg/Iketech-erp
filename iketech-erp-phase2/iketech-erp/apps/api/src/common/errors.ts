import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { ZodError } from 'zod';

/** A rule of the business was broken. `code` is stable and shown to users and tests. */
export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422, public readonly details?: unknown) {
    super(message);
  }
}
export const notFound = (what: string) => new DomainError('NOT_FOUND', `${what} not found`, 404);
export const forbidden = (message: string) => new DomainError('FORBIDDEN', message, 403);
export const conflict = (code: string, message: string) => new DomainError(code, message, 409);

const PG_UNIQUE = '23505';
const PG_CHECK = '23514';
const PG_FK = '23503';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly log = new Logger('Errors');

  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    let status = 500;
    let body: Record<string, unknown> = { code: 'INTERNAL', message: 'Something went wrong. The error has been logged.' };

    if (err instanceof DomainError) {
      status = err.status;
      body = { code: err.code, message: err.message, details: err.details };
    } else if (err instanceof ZodError) {
      status = 400;
      body = { code: 'VALIDATION', message: 'Some fields are invalid', details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) };
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      const r = err.getResponse() as any;
      body = { code: status === 429 ? 'RATE_LIMITED' : 'HTTP', message: typeof r === 'string' ? r : r.message };
    } else if (err?.code === PG_UNIQUE) {
      status = 409;
      body = { code: 'DUPLICATE', message: duplicateMessage(err.constraint), details: { constraint: err.constraint } };
    } else if (err?.code === PG_CHECK || err?.code === PG_FK) {
      status = 422;
      const m = String(err.message || '');
      const code = m.match(/^([A-Z_]+):/)?.[1] ?? (err.code === PG_FK ? 'INVALID_REFERENCE' : 'CONSTRAINT');
      body = { code, message: m.replace(/^[A-Z_]+:\s*/, '') || 'A data rule was violated', details: { constraint: err.constraint } };
    } else {
      // Log the stack without request bodies, so customer data and secrets never reach the logs.
      this.log.error(err?.stack ?? String(err));
    }
    res.status(status).json(body);
  }
}

function duplicateMessage(constraint?: string): string {
  const map: Record<string, string> = {
    customers_phone_uq: 'A customer of this type with this phone number already exists',
    customers_email_uq: 'A customer of this type with this email already exists',
    vehicles_vin_uq: 'A vehicle with this VIN is already registered',
    vehicles_plate_active_uq: 'A vehicle with this plate number is already registered',
    jobs_one_open_per_vehicle: 'This vehicle already has an open job',
    payments_method_reference_uq: 'A payment with this method and reference is already recorded',
    invoices_one_per_job: 'This job already has an invoice',
    users_email_key: 'A user with this email already exists',
  };
  return (constraint && map[constraint]) || 'This record already exists';
}
