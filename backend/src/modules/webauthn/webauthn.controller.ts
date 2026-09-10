import {
    Body,
    Controller,
    Delete,
    Get,
    HttpCode,
    Param,
    Post,
    Query,
    Req,
    Res,
    UnauthorizedException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Public } from '../auth/public.decorator';
import { RateLimitPolicy } from '../../common/rate-limit/rate-limit.decorator';
import { AuthTokenPayload } from '../auth/auth.types';
import { WebauthnService } from './webauthn.service';
import {
    WebauthnLoginOptionsDto,
    WebauthnLoginVerifyDto,
    WebauthnRegisterVerifyDto,
} from './dto/webauthn.dto';

@Controller('auth/webauthn')
export class WebauthnController {
    constructor(private readonly svc: WebauthnService) {}

    /* --------------------------- enrollment (auth) --------------------------- */

    @Post('register/options')
    @HttpCode(200)
    async registerOptions(@Req() req: Request & { user?: AuthTokenPayload }) {
        const client = await this.svc.getClientById(this.currentClientId(req));
        return this.svc.generateRegistration(client);
    }

    @Post('register/verify')
    @HttpCode(200)
    async registerVerify(
        @Req() req: Request & { user?: AuthTokenPayload },
        @Body() body: WebauthnRegisterVerifyDto,
    ) {
        const client = await this.svc.getClientById(this.currentClientId(req));
        return this.svc.verifyRegistration(client, body.challengeId, body.response, body.deviceLabel);
    }

    @Get('credentials')
    async listCredentials(@Req() req: Request & { user?: AuthTokenPayload }) {
        return this.svc.listForClient(this.currentClientId(req));
    }

    @Delete('credentials/:id')
    @HttpCode(200)
    async deleteCredential(
        @Req() req: Request & { user?: AuthTokenPayload },
        @Param('id') id: string,
    ) {
        return this.svc.deleteForClient(this.currentClientId(req), id);
    }

    /* ------------------------------ login (public) -------------------------- */

    @Public()
    @Get('available')
    @HttpCode(200)
    async available(@Query('phone') phone?: string) {
        if (!phone) return { enrolled: false };
        const enrolled = await this.svc.hasCredentialsForPhone(phone);
        return { enrolled };
    }

    @Public()
    @Post('login/options')
    @HttpCode(200)
    async loginOptions(@Body() body: WebauthnLoginOptionsDto) {
        return this.svc.generateLogin(body?.phone);
    }

    @Public()
    @RateLimitPolicy('otp-verify')
    @Post('login/verify')
    @HttpCode(200)
    async loginVerify(
        @Body() body: WebauthnLoginVerifyDto,
        @Res({ passthrough: true }) res: Response,
        @Req() req: Request,
    ) {
        const result = await this.svc.verifyLogin(body.challengeId, body.response, {
            userAgent: req.headers['user-agent'],
            rememberMe: body.rememberMe,
        });
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

    private currentClientId(req: Request & { user?: AuthTokenPayload }): number {
        const raw = Number(req.user?.sub);
        if (!Number.isInteger(raw) || raw <= 0) {
            throw new UnauthorizedException('AUTH_TOKEN_MISSING');
        }
        return raw;
    }

    private setRefreshCookie(res: Response, token?: string, expiresAt?: string) {
        const isProd = process.env.NODE_ENV === 'production';
        if (token && expiresAt) {
            const maxAge = Math.max(new Date(expiresAt).getTime() - Date.now(), 0);
            res.cookie('refreshToken', token, {
                httpOnly: true,
                secure: isProd,
                sameSite: 'strict',
                maxAge,
                path: '/',
            });
        } else {
            res.cookie('refreshToken', '', { httpOnly: true, secure: isProd, sameSite: 'strict', maxAge: 0, path: '/' });
        }
    }
}
