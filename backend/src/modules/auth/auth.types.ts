export type AuthRole = 'client' | 'admin';

export interface AuthTokenPayload {
    sub: string;
    phone: string;
    roles: AuthRole[];
    isAdmin: boolean;
    firstName?: string;
    lastName?: string;
    iat?: number;
    exp?: number;
}

export interface AuthTokens {
    ok: boolean;
    client: any;
    roles: AuthRole[];
    token: string;
    expiresAt: string;
    refreshToken?: string;
    refreshExpiresAt?: string;
}
