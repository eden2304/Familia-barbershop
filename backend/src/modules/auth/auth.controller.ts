import { Body, Controller, HttpCode, Post, ConflictException } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller()
export class AuthController {
    constructor(private readonly svc: AuthService) {}

    @Post('auth/request-code')
    @HttpCode(200)
    async requestCode(@Body() body: any) {
        const phone = body.phone ?? body.phoneNumber ?? body.mobile ?? body.tel;

        // אם כבר רשום — 409 מיד (עוצר FRONT לפני מסך הקוד)
        const exists = await this.svc.isRegistered(phone);
        if (exists) {
            throw new ConflictException('ALREADY_REGISTERED');
        }

        await this.svc.requestCode(phone);
        return { ok: true, success: true };
    }


    // (שאר המתודות ללא שינוי)
    @Post('auth/request-code-login')
    @HttpCode(200)
    async requestCodeLogin(@Body() body: any) {
        const phone = body.phone ?? body.phoneNumber ?? body.mobile ?? body.tel;
        const exists = await this.svc.isRegistered(phone);
        if (!exists) {
            throw new ConflictException('UNREGISTERED_CLIENT');
        }
        await this.svc.requestCode(phone);
        return { ok: true, success: true };
    }

    @Post('auth/verify-code') @HttpCode(200)
    async verifyCode(@Body() body: any) {
        const res = await this.svc.verifyCode(this.mapVerifyBody(body));
        const c = res.client;
        return {
            ok: true,
            success: true,
            user: { ...c, isAdmin: res.roles?.includes('admin') },
            client: { ...c, isAdmin: res.roles?.includes('admin') },
            token: res.token,
            expiresAt: res.expiresAt,
            roles: res.roles,
            id: c.id,
            phone: c.phone,
            firstName: (c as any).firstName,
            lastName:  (c as any).lastName,
        };
    }

    @Post('auth/register') @HttpCode(200)
    async register(@Body() body: any) {
        const res = await this.svc.register(this.mapVerifyBody(body));
        const c = res.client;
        return {
            ok: true,
            success: true,
            user: { ...c, isAdmin: res.roles?.includes('admin') },
            client: { ...c, isAdmin: res.roles?.includes('admin') },
            token: res.token,
            expiresAt: res.expiresAt,
            roles: res.roles,
            id: c.id,
            phone: c.phone,
            firstName: (c as any).firstName,
            lastName:  (c as any).lastName,
        };
    }

    @Post('auth/check-phone')
    @HttpCode(200)
    async checkPhone(@Body() body: any) {
        const phone = body.phone ?? body.phoneNumber ?? body.mobile ?? body.tel;
        const exists = await this.svc.isRegistered(phone);
        return { ok: true, exists };
    }

    // אליאסים – ללא שינוי...
    @Post('auth/send-otp')        @HttpCode(200) sendOtp(@Body() b: any)        { return this.requestCode(b); }
    @Post('auth/verify')          @HttpCode(200) verifyAlias(@Body() b: any)    { return this.verifyCode(b); }
    @Post('users/request-code')   @HttpCode(200) uReq(@Body() b: any)           { return this.requestCode(b); }
    @Post('users/verify-code')    @HttpCode(200) uVer(@Body() b: any)           { return this.verifyCode(b); }
    @Post('clients/register')     @HttpCode(200) regClients(@Body() b: any)     { return this.register(b); }
    @Post('users/register')       @HttpCode(200) regUsers(@Body() b: any)       { return this.register(b); }
    @Post('users/request-code-login') @HttpCode(200) uReqLogin(@Body() b: any)  { return this.requestCodeLogin(b); }

    private mapVerifyBody(body: any): {
        phone: string; code: string; firstName?: string; lastName?: string;
    } {
        const phone = body.phone ?? body.phoneNumber ?? body.mobile ?? body.tel;
        const code  = String(body.code ?? body.otp ?? body.pin ?? body.passcode ?? '');
        const fn = body.firstName ?? body.clientFirstName ?? body.givenName ?? body.nameFirst ?? body.first ?? body.name?.split(' ')?.[0];
        const ln = body.lastName  ?? body.clientLastName  ?? body.familyName ?? body.nameLast  ?? body.last  ?? body.name?.split(' ')?.slice(1).join(' ');
        return { phone, code, firstName: fn, lastName: ln };
    }
}
