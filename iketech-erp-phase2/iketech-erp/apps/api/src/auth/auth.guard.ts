import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service';
import { PERMISSION_KEY, PUBLIC_KEY } from './decorators';
import { DomainError } from '../common/errors';

export const SESSION_COOKIE = 'iketech_session';

/** Global guard: authenticates the session cookie, then checks the route's declared permissions on the server. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly auth: AuthService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const perms = this.reflector.getAllAndOverride<string[]>(PERMISSION_KEY, targets);
    if (!perms) throw new DomainError('ROUTE_NOT_DECLARED', 'This route has no permission declared', 500);

    const req = ctx.switchToHttp().getRequest();
    const token = req.cookies?.[SESSION_COOKIE];
    const user = token ? await this.auth.resolve(token) : null;
    if (!user) throw new DomainError('UNAUTHENTICATED', 'Please sign in', 401);
    user.ip = req.ip;
    req.user = user;
    req.sessionToken = token;
    // An empty list means "any signed-in user" (e.g. /auth/me).
    if (perms.length && !perms.some((p) => user.permissions.has(p))) {
      throw new DomainError('FORBIDDEN', 'You do not have permission for this action', 403);
    }
    return true;
  }
}
