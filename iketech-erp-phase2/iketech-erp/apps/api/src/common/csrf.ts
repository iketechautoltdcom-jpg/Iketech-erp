import { NextFunction, Request, Response } from 'express';

/**
 * CSRF defence for cookie sessions: state-changing requests must carry the X-Requested-With header (which a
 * cross-site form cannot set) and, when the browser sends an Origin, it must be the staff web app's origin.
 * Combined with SameSite=Strict cookies.
 */
export function csrfGuard(allowedOrigins: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.includes(origin)) return res.status(403).json({ code: 'BAD_ORIGIN', message: 'Request origin not allowed' });
    if (req.headers['x-requested-with'] !== 'iketech-erp') return res.status(403).json({ code: 'CSRF', message: 'Missing request header' });
    next();
  };
}
