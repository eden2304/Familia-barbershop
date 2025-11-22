import { Body, Controller, HttpCode, Post, ConflictException, Res, Req, UnauthorizedException } from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { RequestCodeDto } from './dto/request-code.dto';
import { VerifyCodeDto } from './dto/verify-code.dto';

function parseCookies(req: Request): Record<string, string> {
    const header = req.headers['cookie'] || '';
    return (header as string).split(';').reduce((acc, part) => {
        const [k, v] = part.trim().split('=');
        if (k && v) acc[k] = decodeURIComponent(v);
        return acc;
    }, {} as Record<string, string>);
}

@Controller()
export class AuthController {
    constructor(private readonly svc: AuthService) {}

    @Post('auth/request-code')
    @HttpCode(200)
    async requestCode(@Body() body: RequestCodeDto) {
        const exists = await this.svc.isRegistered(body.phone);
        if (exists) {
            throw new ConflictException('ALREADY_REGISTERED');
        }
        await this.svc.requestCode(body.phone);
        return { ok: true, success: true };
    }

    @Post('auth/request-code-login')
    @HttpCode(200)
    async requestCodeLogin(@Body() body: RequestCodeDto) {
        const exists = await this.svc.isRegistered(body.phone);
        if (!exists) {
            throw new ConflictException('UNREGISTERED_CLIENT');
        }
        await this.svc.requestCode(body.phone);
        return { ok: true, success: true };
    }

    @Post('auth/verify-code')
    @HttpCode(200)
    async verifyCode(@Body() body: VerifyCodeDto, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
        const result = await this.svc.verifyCode({ ...body, userAgent: req.headers['user-agent'] });
        this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
        const c = result.client;
        return {
            ok: true,
            success: true,
            user: { ...c, isAdmin: result.roles?.includes('admin') },
            client: { ...c, isAdmin: result.roles?.includes('admin') },
            token: result.token,
            expiresAt: result.expiresAt,
            roles: result.roles,
            id: c.id,
            phone: c.phone,
            firstName: (c as any).firstName,
            lastName: (c as any).lastName,
        };
    }

    @Post('auth/register')
    @HttpCode(200)
    async register(@Body() body: VerifyCodeDto, @Res({ passthrough: true }) res: Response, @Req() req: Request) {
        const result = await this.svc.register({ ...body, userAgent: req.headers['user-agent'] });
        this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
        const c = result.client;
        return {
            ok: true,
            success: true,
            user: { ...c, isAdmin: result.roles?.includes('admin') },
            client: { ...c, isAdmin: result.roles?.includes('admin') },
            token: result.token,
            expiresAt: result.expiresAt,
            roles: result.roles,
            id: c.id,
            phone: c.phone,
            firstName: (c as any).firstName,
            lastName: (c as any).lastName,
        };
    }

    @Post('auth/refresh')
    @HttpCode(200)
    async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const cookies = parseCookies(req);
        const refreshToken = cookies['refreshToken'];
        if (!refreshToken) throw new UnauthorizedException('MISSING_REFRESH');
        const result = await this.svc.refreshAccessToken(refreshToken);
        this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresAt);
        return {
            token: result.token,
            expiresAt: result.expiresAt,
            roles: result.roles,
            client: result.client,
            refreshExpiresAt: result.refreshExpiresAt,
        };
    }

    @Post('auth/logout')
    @HttpCode(200)
    async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
        const cookies = parseCookies(req);
        const refreshToken = cookies['refreshToken'];
        if (refreshToken) {
            await this.svc.revokeRefreshToken(refreshToken).catch(() => undefined);
        }
        res.cookie('refreshToken', '', { httpOnly: true, secure: true, sameSite: 'lax', maxAge: 0, path: '/' });
        return { ok: true };
    }

    @Post('auth/check-phone')
    @HttpCode(200)
    async checkPhone(@Body() body: RequestCodeDto) {
        const exists = await this.svc.isRegistered(body.phone);
        return { ok: true, exists };
    }

    @Post('auth/send-otp')
    @HttpCode(200)
    sendOtp(@Body() b: RequestCodeDto) { return this.requestCode(b); }

    @Post('auth/verify')
    @HttpCode(200)
    verifyAlias(@Body() b: VerifyCodeDto, @Res({ passthrough: true }) r: Response, @Req() req: Request) { return this.verifyCode(b, r, req); }

    @Post('users/request-code')
    @HttpCode(200)
    uReq(@Body() b: RequestCodeDto) { return this.requestCode(b); }

    @Post('users/verify-code')
    @HttpCode(200)
    uVer(@Body() b: VerifyCodeDto, @Res({ passthrough: true }) r: Response, @Req() req: Request) { return this.verifyCode(b, r, req); }

    @Post('clients/register')
    @HttpCode(200)
    regClients(@Body() b: VerifyCodeDto, @Res({ passthrough: true }) r: Response, @Req() req: Request) { return this.register(b, r, req); }

    @Post('users/register')
    @HttpCode(200)
    regUsers(@Body() b: VerifyCodeDto, @Res({ passthrough: true }) r: Response, @Req() req: Request) { return this.register(b, r, req); }

    @Post('users/request-code-login')
    @HttpCode(200)
    uReqLogin(@Body() b: RequestCodeDto) { return this.requestCodeLogin(b); }

    private setRefreshCookie(res: Response, token?: string, expiresAt?: string) {
        const isProd = process.env.NODE_ENV === 'production';
        if (token && expiresAt) {
            const maxAge = Math.max(new Date(expiresAt).getTime() - Date.now(), 0);
            res.cookie('refreshToken', token, {
                httpOnly: true,
                secure: isProd,
                sameSite: 'lax',
                maxAge,
                path: '/',
            });
        } else {
            res.cookie('refreshToken', '', { httpOnly: true, secure: isProd, sameSite: 'lax', maxAge: 0, path: '/' });
        }
    }
}
