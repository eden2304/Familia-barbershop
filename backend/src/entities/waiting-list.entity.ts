import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Client } from '../clients/client.entity';
import { ServiceEntity } from './service.entity';

export type WaitingStatus = 'open' | 'matched' | 'closed';

@Entity('waiting_list')
export class WaitingList {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @ManyToOne(() => Client, { eager: true, nullable: true })
    client?: Client;

    @Column({ name: 'client_name', type: 'varchar', length: 200, nullable: true })
    clientName?: string;

    @Column({ type: 'varchar', length: 20, nullable: true })
    phone?: string;

    @ManyToOne(() => ServiceEntity, { eager: true, nullable: true })
    service?: ServiceEntity;

    @Column({ name: 'desired_date', type: 'date' })
    desiredDate: string; // YYYY-MM-DD

    @Column({ name: 'desired_time', length: 5 }) // "14:00"
    desiredTime: string;

    @Column({ name: 'is_club_member', type: 'boolean', default: false })
    isClubMember: boolean;

    @Column({ type: 'varchar', length: 16, default: 'open' })
    status: WaitingStatus;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
