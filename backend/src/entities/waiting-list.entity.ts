import { Column, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Client } from '../clients/client.entity';
import { ServiceEntity } from './service.entity';

export type WaitingStatus =
    | 'open'
    | 'matched'
    | 'closed'
    | 'waiting'
    | 'notified'
    | 'booked'
    | 'canceled';

@Entity('waiting_list')
export class WaitingList {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Client, { eager: true })
    client: Client;

    @ManyToOne(() => ServiceEntity, { eager: true, nullable: true })
    service?: ServiceEntity;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ length: 5 }) // "14:00"
    time: string;

    @Column({ type: 'varchar', length: 16, default: 'open' })
    status: WaitingStatus;
}
