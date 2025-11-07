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

    // ❌ הסר/הער את זה:
    // @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    // createdAt: Date;
}
