import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
    OnModuleInit,
    ServiceUnavailableException,
    UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';

import { Client } from '../../clients/client.entity';
import { Setting } from '../../entities/setting.entity';
import { WebauthnCredential } from '../../entities/webauthn-credential.entity';
import { AuthService } from '../auth/auth.service';
import { maskPhone } from '../../common/security.utils';

interface StoredChallenge {
    challenge: string;
    kind: 'registration' | 'authentication';
    clientId?: number;
    createdAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

@Injectable()
export class WebauthnService implements OnModuleInit {
    private readonly logger = new Logger(WebauthnService.name);

    private readonly rpName: string;
    private readonly rpID: string;
    private readonly expectedOrigins: string[];

    constructor(
        @InjectRepository(WebauthnCredential)
        private readonly credRepo: Repository<WebauthnCredential>,
        @InjectRepository(Client)
        private readonly clientRepo: Repository<Client>,
        @InjectRepository(Setting)
        private readonly settingRepo: Repository<Setting>,
        @InjectDataSource()
        private readonly ds: DataSource,
        private readonly config: ConfigService,
        private readonly authService: AuthService,
    ) {
        this.rpName = String(this.config.get<string>('WEBAUTHN_RP_NAME') || 'Familia').trim();

        this.expectedOrigins = String(this.config.get<string>('WEBAUTHN_ORIGIN') || 'http://localhost:5173')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

        const configuredRpId = String(this.config.get<string>('WEBAUTHN_RP_ID') || '').trim();
        this.rpID = configuredRpId || this.deriveRpIdFromOrigins() || 'localhost';

        if (process.env.NODE_ENV === 'production' && !configuredRpId) {
            this.logger.warn(
                `WEBAUTHN_RP_ID is not set. Falling back to "${this.rpID}" derived from WEBAUTHN_ORIGIN. ` +
                'Set it explicitly to the site domain or biometric login will break.',
            );
        }
        this.logger.log(`WebAuthn configured: rpID="${this.rpID}", origins=[${this.expectedOrigins.join(', ')}]`);
    }

    // Safety net so a deploy works even if the migration has not run yet.
    // Each statement runs in its own try/catch: gen_random_uuid() is core in
    // Postgres 13+ (no extension, no superuser), and a failing index must not
    // stop the table from being created.
    async onModuleInit() {
        const statements = [
            `CREATE TABLE IF NOT EXISTS "webauthn_credentials" (
                "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                "client_id" integer NOT NULL,
                "credential_id" text NOT NULL,
                "public_key" text NOT NULL,
                "counter" bigint NOT NULL DEFAULT 0,
                "transports" character varying(128),
                "device_label" character varying(120),
                "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
                "last_used_at" TIMESTAMPTZ
            )`,
            `CREATE UNIQUE INDEX IF NOT EXISTS "uq_webauthn_credentials_credential_id" ON "webauthn_credentials" ("credential_id")`,
            `CREATE INDEX IF NOT EXISTS "idx_webauthn_credentials_client_id" ON "webauthn_credentials" ("client_id")`,
        ];
        for (const sql of statements) {
            try {
                await this.ds.query(sql);
            } catch (error) {
                this.logger.warn(
                    `webauthn_credentials self-heal statement failed: ${error instanceof Error ? error.message : error}`,
                );
            }
        }

        const check = await this.ds
            .query(`SELECT to_regclass('public.webauthn_credentials') AS reg`)
            .catch(() => [{ reg: null }]);
        if (check?.[0]?.reg) {
            this.logger.log('webauthn_credentials table is present.');
        } else {
            this.logger.error(
                'webauthn_credentials table is MISSING and could not be created — biometric login will fail. ' +
                'Run "npm run migrate:run" against the production database.',
            );
        }
    }

    private deriveRpIdFromOrigins(): string {
        for (const origin of this.expectedOrigins) {
            try {
                return new URL(origin).hostname;
            } catch {
                // keep trying
            }
        }
        return '';
    }

    /* ----------------------------- challenge KV ----------------------------- */

    private challengeKey(id: string): string {
        return `webauthn:chal:${id}`;
    }

    private async storeChallenge(payload: StoredChallenge): Promise<string> {
        const id = randomBytes(18).toString('base64url');
        const key = this.challengeKey(id);
        await this.settingRepo.save(this.settingRepo.create({ key, value: payload }));
        return id;
    }

    private async consumeChallenge(
        id: string,
        kind: StoredChallenge['kind'],
    ): Promise<StoredChallenge> {
        const key = this.challengeKey(id);
        const row = await this.settingRepo.findOne({ where: { key } });
        if (!row) throw new BadRequestException('CHALLENGE_NOT_FOUND');
        const value = row.value as StoredChallenge;
        await this.settingRepo.delete({ key });
        if (!value || value.kind !== kind) throw new BadRequestException('CHALLENGE_INVALID');
        if (Date.now() - Number(value.createdAt || 0) > CHALLENGE_TTL_MS) {
            throw new BadRequestException('CHALLENGE_EXPIRED');
        }
        return value;
    }

    /* ------------------------------ enrollment ----------------------------- */

    async generateRegistration(client: Client) {
        let existing: WebauthnCredential[];
        try {
            existing = await this.credRepo.find({ where: { clientId: client.id } });
        } catch (error) {
            this.logger.error(
                `WebAuthn enrollment unavailable (is the webauthn_credentials table present?): ${error instanceof Error ? error.message : error}`,
            );
            throw new ServiceUnavailableException('BIOMETRIC_UNAVAILABLE');
        }
        const firstName = (client as any).firstName ?? client.first_name ?? '';
        const lastName = (client as any).lastName ?? client.last_name ?? '';
        const displayName = `${firstName} ${lastName}`.trim() || client.phone;

        const options = await generateRegistrationOptions({
            rpName: this.rpName,
            rpID: this.rpID,
            userName: client.phone,
            userDisplayName: displayName,
            userID: new TextEncoder().encode(String(client.id)),
            timeout: 60_000,
            attestationType: 'none',
            excludeCredentials: existing.map((c) => ({
                id: c.credentialId,
                transports: this.parseTransports(c.transports),
            })),
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
                requireResidentKey: false,
            },
        });

        const challengeId = await this.storeChallenge({
            challenge: options.challenge,
            kind: 'registration',
            clientId: client.id,
            createdAt: Date.now(),
        });

        return { challengeId, options };
    }

    async verifyRegistration(
        client: Client,
        challengeId: string,
        response: Record<string, any>,
        deviceLabel?: string,
    ) {
        const stored = await this.consumeChallenge(challengeId, 'registration');
        if (stored.clientId !== client.id) {
            throw new BadRequestException('CHALLENGE_INVALID');
        }

        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response: response as any,
                expectedChallenge: stored.challenge,
                expectedOrigin: this.expectedOrigins,
                expectedRPID: this.rpID,
                requireUserVerification: false,
            });
        } catch (error) {
            this.logger.warn(`WebAuthn registration verify failed for ${maskPhone(client.phone)}: ${String((error as Error)?.message || error)}`);
            throw new BadRequestException('REGISTRATION_VERIFICATION_FAILED');
        }

        if (!verification.verified || !verification.registrationInfo) {
            throw new BadRequestException('REGISTRATION_NOT_VERIFIED');
        }

        const { credential, credentialBackedUp } = verification.registrationInfo;
        const credentialId = credential.id;
        const publicKey = isoBase64URL.fromBuffer(credential.publicKey);
        const transports = Array.isArray(credential.transports) ? credential.transports.join(',') : null;

        const already = await this.credRepo.findOne({ where: { credentialId } });
        if (already) {
            if (already.clientId !== client.id) {
                throw new BadRequestException('CREDENTIAL_ALREADY_REGISTERED');
            }
            already.publicKey = publicKey;
            already.counter = String(credential.counter ?? 0);
            already.transports = transports;
            if (deviceLabel) already.deviceLabel = deviceLabel;
            already.lastUsedAt = new Date();
            await this.credRepo.save(already);
            return { ok: true, credentialId: already.id };
        }

        const row = this.credRepo.create({
            clientId: client.id,
            credentialId,
            publicKey,
            counter: String(credential.counter ?? 0),
            transports,
            deviceLabel: deviceLabel || null,
            lastUsedAt: new Date(),
        });
        await this.credRepo.save(row);
        this.logger.log(
            `WebAuthn credential enrolled for ${maskPhone(client.phone)} (backedUp=${Boolean(credentialBackedUp)})`,
        );
        return { ok: true, credentialId: row.id };
    }

    /* -------------------------------- login ------------------------------- */

    async generateLogin(phone?: string) {
        let clientId: number | undefined;
        let allowCredentials: Array<{ id: string; transports?: any }> | undefined;

        if (phone) {
            const client = await this.authService.findClientByPhone(phone);
            if (client) {
                clientId = client.id;
                const creds = await this.credRepo.find({ where: { clientId: client.id } });
                allowCredentials = creds.map((c) => ({
                    id: c.credentialId,
                    transports: this.parseTransports(c.transports),
                }));
            }
        }

        const options = await generateAuthenticationOptions({
            rpID: this.rpID,
            timeout: 60_000,
            userVerification: 'preferred',
            ...(allowCredentials && allowCredentials.length ? { allowCredentials } : {}),
        });

        const challengeId = await this.storeChallenge({
            challenge: options.challenge,
            kind: 'authentication',
            clientId,
            createdAt: Date.now(),
        });

        return { challengeId, options };
    }

    async verifyLogin(
        challengeId: string,
        response: Record<string, any>,
        opts: { userAgent?: string; rememberMe?: boolean },
    ) {
        const stored = await this.consumeChallenge(challengeId, 'authentication');

        const rawId = typeof response?.id === 'string' ? response.id : null;
        if (!rawId) throw new BadRequestException('MALFORMED_CREDENTIAL');

        let cred: WebauthnCredential | null;
        try {
            cred = await this.credRepo.findOne({ where: { credentialId: rawId } });
        } catch (error) {
            this.logger.error(
                `WebAuthn credential lookup failed (is the webauthn_credentials table present?): ${error instanceof Error ? error.message : error}`,
            );
            throw new ServiceUnavailableException('BIOMETRIC_UNAVAILABLE');
        }
        if (!cred) {
            this.logger.warn(`WebAuthn login: no stored credential for id ${rawId.slice(0, 12)}…`);
            throw new UnauthorizedException('CREDENTIAL_NOT_FOUND');
        }
        if (stored.clientId && stored.clientId !== cred.clientId) {
            throw new UnauthorizedException('CREDENTIAL_MISMATCH');
        }

        const client = await this.clientRepo.findOne({ where: { id: cred.clientId } });
        if (!client) throw new UnauthorizedException('CREDENTIAL_NOT_FOUND');

        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response: response as any,
                expectedChallenge: stored.challenge,
                expectedOrigin: this.expectedOrigins,
                expectedRPID: this.rpID,
                requireUserVerification: false,
                credential: {
                    id: cred.credentialId,
                    publicKey: isoBase64URL.toBuffer(cred.publicKey),
                    counter: Number(cred.counter) || 0,
                    transports: this.parseTransports(cred.transports),
                },
            });
        } catch (error) {
            this.logger.warn(`WebAuthn login verify failed: ${String((error as Error)?.message || error)}`);
            throw new UnauthorizedException('AUTHENTICATION_FAILED');
        }

        if (!verification.verified) {
            throw new UnauthorizedException('AUTHENTICATION_FAILED');
        }

        cred.counter = String(verification.authenticationInfo.newCounter ?? cred.counter);
        cred.lastUsedAt = new Date();
        await this.credRepo.save(cred);

        return this.authService.issueSessionForClient(client, opts.rememberMe, opts.userAgent);
    }

    /* --------------------------- device management ------------------------ */

    async listForClient(clientId: number) {
        const rows = await this.credRepo.find({
            where: { clientId },
            order: { createdAt: 'DESC' },
        });
        return rows.map((r) => ({
            id: r.id,
            deviceLabel: r.deviceLabel,
            createdAt: r.createdAt,
            lastUsedAt: r.lastUsedAt,
        }));
    }

    async deleteForClient(clientId: number, id: string) {
        const row = await this.credRepo.findOne({ where: { id, clientId } });
        if (!row) throw new NotFoundException('CREDENTIAL_NOT_FOUND');
        await this.credRepo.delete({ id: row.id });
        return { ok: true };
    }

    async getClientById(id: number): Promise<Client> {
        const client = await this.clientRepo.findOne({ where: { id } });
        if (!client) throw new UnauthorizedException('CLIENT_NOT_FOUND');
        return client;
    }

    async hasCredentialsForPhone(phone: string): Promise<boolean> {
        const client = await this.authService.findClientByPhone(phone);
        if (!client) return false;
        const count = await this.credRepo.count({ where: { clientId: client.id } });
        return count > 0;
    }

    private parseTransports(value: string | null): any[] | undefined {
        if (!value) return undefined;
        const list = value.split(',').map((s) => s.trim()).filter(Boolean);
        return list.length ? (list as any[]) : undefined;
    }
}
