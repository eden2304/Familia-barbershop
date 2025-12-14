import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { ROLES_KEY } from './roles.decorator';
import { AuthRole, AuthTokenPayload } from './auth.types';
import { IS_PUBLIC_KEY } from './public.decorator';

@Injectable()
export class JwtAuthGuard implements CanActivate {
    constructor(
        private readonly authService: AuthService,
        private readonly reflector: Reflector,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);
        if (isPublic) return true;

        const request = context.switchToHttp().getRequest<Request & { user?: AuthTokenPayload }>();
        const token = this.extractToken(request);
        if (!token) {
            throw new UnauthorizedException('AUTH_TOKEN_MISSING');
        }

        const payload = await this.authService.verifyToken(token).catch(() => {
            throw new UnauthorizedException('INVALID_TOKEN');
        });

        request.user = payload;

        const requiredRoles = this.reflector.getAllAndOverride<AuthRole[]>(ROLES_KEY, [
            context.getHandler(),
            context.getClass(),
        ]);

        if (requiredRoles && requiredRoles.length > 0) {
            const hasRole = payload.roles?.some((role) => requiredRoles.includes(role));
            if (!hasRole) {
                throw new ForbiddenException('INSUFFICIENT_ROLE');
            }
        }

        return true;
    }

    private extractToken(request: Request): string | null {
        const auth = request.headers['authorization'] || request.headers['Authorization'];
        if (typeof auth !== 'string') return null;
        const [scheme, token] = auth.split(' ');
        if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
        return token;
    }
}
