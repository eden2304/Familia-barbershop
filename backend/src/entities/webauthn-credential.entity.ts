import {
    Column,
    CreateDateColumn,
    Entity,
    Index,
    ManyToOne,
    PrimaryGeneratedColumn,
} from 'typeorm';
import { Client } from '../clients/client.entity';

// One passkey / platform-authenticator credential (Face ID, Touch ID, fingerprint,
// Windows Hello, …) enrolled by a client on a single device. A client may have
// several rows — one per device/browser they enrolled from.
@Entity({ name: 'webauthn_credentials' })
export class WebauthnCredential {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Index('idx_webauthn_credentials_client_id')
    @Column({ type: 'int', name: 'client_id' })
    clientId: number;

    @ManyToOne(() => Client, { onDelete: 'CASCADE' })
    client: Client;

    // Base64URL-encoded credential id returned by the authenticator.
    @Index('uq_webauthn_credentials_credential_id', { unique: true })
    @Column({ type: 'text', name: 'credential_id' })
    credentialId: string;

    // Base64URL-encoded COSE public key.
    @Column({ type: 'text', name: 'public_key' })
    publicKey: string;

    // Signature counter for clone detection. Many modern authenticators keep this
    // at 0, so we only ever move it forward, never reject on equality.
    @Column({ type: 'bigint', default: 0 })
    counter: string;

    // e.g. "internal", "hybrid", "usb" — comma-joined.
    @Column({ type: 'varchar', length: 128, nullable: true })
    transports: string | null;

    // Free-text hint shown to the user ("iPhone של חן", browser UA snippet…).
    @Column({ type: 'varchar', length: 120, name: 'device_label', nullable: true })
    deviceLabel: string | null;

    @CreateDateColumn({ type: 'timestamp with time zone', name: 'created_at' })
    createdAt: Date;

    @Column({ type: 'timestamp with time zone', name: 'last_used_at', nullable: true })
    lastUsedAt: Date | null;
}
