import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Permission } from './rbac';

export const PERMISSION_KEY = 'permission';
export const PUBLIC_KEY = 'public';

/** Every route must declare either @Requires(...) or @Public(); a test fails the build otherwise. */
export const Requires = (...perms: Permission[]) => SetMetadata(PERMISSION_KEY, perms);
export const Public = () => SetMetadata(PUBLIC_KEY, true);

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  branchId: string;
  roles: string[];
  permissions: Set<string>;
  ip?: string;
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);
