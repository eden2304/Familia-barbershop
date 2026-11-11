import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity({ name: 'clients' })
export class Client {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({type: 'varchar', length: 80})
    first_name: string;

    @Column({type: 'varchar', length: 120, default: ''})
    last_name: string;

    @Index({unique: true})
    @Column({type: 'varchar', length: 20})
    phone: string; // normalized to Israeli leading 0

    @Column({ type: 'boolean', name: 'is_member', default: false })
    is_member: boolean;

    get isMember(): boolean {
        return this.is_member;
    }

    set isMember(value: boolean) {
        this.is_member = value;
    }

    @Column({ type: 'boolean', name: 'is_blocked', default: false })
    is_blocked: boolean;

    get isBlocked(): boolean {
        return this.is_blocked;
    }

    set isBlocked(value: boolean) {
        this.is_blocked = value;
    }

    // Most recent appointment ever booked for this client. Persisted so it
    // survives appointment pruning / end-of-day deletion — only ever moves forward.
    @Column({ type: 'timestamp with time zone', name: 'last_appointment_at', nullable: true })
    last_appointment_at: Date | null;

    get lastAppointmentAt(): Date | null {
        return this.last_appointment_at ?? null;
    }

    set lastAppointmentAt(value: Date | null) {
        this.last_appointment_at = value ?? null;
    }

    // ---- Personal login PIN (4–6 digits), see ClientPinService ----
    // select/insert/update are disabled on purpose: regular ORM reads and writes of a
    // client never touch these columns (so client queries keep working even before
    // the columns exist). ClientPinService reads/writes them with explicit SQL.

    // scrypt hash of the PIN, JSON {hash, salt, iterations}. NULL = no PIN set yet.
    @Column({ type: 'text', name: 'pin_hash', nullable: true, select: false, insert: false, update: false })
    pin_hash?: string | null;

    @Column({ type: 'smallint', name: 'pin_length', nullable: true, select: false, insert: false, update: false })
    pin_length?: number | null;

    @Column({ type: 'integer', name: 'pin_failed_attempts', default: 0, select: false, insert: false, update: false })
    pin_failed_attempts?: number;

    @Column({ type: 'timestamp with time zone', name: 'pin_locked_until', nullable: true, select: false, insert: false, update: false })
    pin_locked_until?: Date | null;

    @Column({ type: 'timestamp with time zone', name: 'pin_updated_at', nullable: true, select: false, insert: false, update: false })
    pin_updated_at?: Date | null;

    @CreateDateColumn({type: 'timestamp with time zone'})
    created_at: Date;
}
