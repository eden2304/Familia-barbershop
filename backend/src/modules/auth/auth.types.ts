export type AuthRole = 'client' | 'admin';

export interface AuthTokenPayload {
    sub: number;
    phone: string;
    roles: AuthRole[];
    isAdmin: boolean;
    firstName?: string;
    lastName?: string;
    iat?: number;
    exp?: number;
}
