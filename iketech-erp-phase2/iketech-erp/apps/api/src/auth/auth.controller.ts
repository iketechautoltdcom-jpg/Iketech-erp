import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { AuthUser, CurrentUser, Public, Requires } from './decorators';
import { SESSION_COOKIE } from './auth.guard';
import { z } from '../common/zod';

const LoginBody = z.object({ email: z.string().email(), password: z.string().min(1).max(200) });

export const serializeUser = (u: AuthUser) => ({
  id: u.id, email: u.email, fullName: u.fullName, branchId: u.branchId, roles: u.roles, permissions: [...u.permissions].sort(),
});

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: Number(process.env.LOGIN_RATE_LIMIT || 10), ttl: 60000 } })
  @Post('login')
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { email, password } = LoginBody.parse(body);
    const { token, user } = await this.auth.login(email, password, req.ip, req.headers['user-agent']);
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 12 * 3600 * 1000,
    });
    return serializeUser(user!);
  }

  @Requires()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: any, @CurrentUser() user: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.sessionToken, user);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
  }

  @Requires()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return serializeUser(user);
  }
}
