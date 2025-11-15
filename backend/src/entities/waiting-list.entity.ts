import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';
import { Client } from '../clients/client.entity';
import { ServiceEntity } from './service.entity';

export type WaitingStatus = 'waiting' | 'notified' | 'booked' | 'canceled';

@Entity({ name: 'waiting_list' })
export class WaitingListEntry {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Client, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'client_id' })
    client?: Client | null;

    @ManyToOne(() => ServiceEntity, { nullable: true, eager: true, onDelete: 'SET NULL' })
    @JoinColumn({ name: 'service_id' })
    service?: ServiceEntity | null;

    @Column({ name: 'client_name', type: 'varchar', length: 255, default: '' })
    clientName: string;

    @Column({ type: 'varchar', length: 32 })
    phone: string;

    @Column({ name: 'desired_starts_at', type: 'timestamptz' })
    desiredStartsAt: Date;

    @Column({ type: 'varchar', length: 32, default: 'waiting' })
    status: WaitingStatus;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;

    @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
    updatedAt: Date;
}
