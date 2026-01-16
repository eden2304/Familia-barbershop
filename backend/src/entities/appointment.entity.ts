import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Client } from '../clients/client.entity';
import { ServiceEntity } from './service.entity';

@Entity({ name: 'appointments' })
export class Appointment {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Client, { eager: false, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'client_id' })
    client: Client;

    @ManyToOne(() => ServiceEntity, { eager: true, onDelete: 'RESTRICT' })
    @JoinColumn({ name: 'service_id' })
    service: ServiceEntity;

    @Column({ name: 'starts_at', type: 'timestamptz' })
    startsAt: Date;

    @Column({ name: 'ends_at', type: 'timestamptz', nullable: true })
    endsAt: Date | null;

    @Column({ type: 'varchar', length: 32, default: 'booked' })
    status: string;

    @Column({ type: 'text', nullable: true })
    note: string | null;

    @Column({ name: 'recurring_id', type: 'int', nullable: true })
    recurringId: number | null;

    // ❌ הסר/הער את זה:
    // @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    // createdAt: Date;
}
