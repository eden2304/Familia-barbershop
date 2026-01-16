import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Client } from '../clients/client.entity';
import { ServiceEntity } from './service.entity';

export type WaitingStatus = 'open' | 'waiting' | 'notified' | 'matched' | 'booked' | 'closed';

@Entity('waiting_list')
export class WaitingList {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Client, { eager: true })
    client: Client;

    @ManyToOne(() => ServiceEntity, { eager: true, nullable: true })
    service?: ServiceEntity;

    @Column({ name: 'client_name', type: 'varchar', length: 200, nullable: true })
    clientName?: string | null;

    @Column({ type: 'varchar', length: 20, nullable: true })
    phone?: string | null;

    @Column({ name: 'desired_starts_at', type: 'timestamptz', nullable: true })
    desiredStartsAt?: Date | null;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ length: 5 }) // "14:00"
    time: string;

    @Column({ type: 'varchar', length: 16, default: 'open' })
    status: WaitingStatus;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
