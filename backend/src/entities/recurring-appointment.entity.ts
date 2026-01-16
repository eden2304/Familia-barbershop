import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn, JoinColumn } from 'typeorm';
import { Client } from '../clients/client.entity';
import { ServiceEntity } from './service.entity';

@Entity({ name: 'recurring_appointments' })
export class RecurringAppointment {
    @PrimaryGeneratedColumn()
    id: number;

    @ManyToOne(() => Client, { eager: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'client_id' })
    client: Client;

    @ManyToOne(() => ServiceEntity, { eager: true, onDelete: 'CASCADE' })
    @JoinColumn({ name: 'service_id' })
    service: ServiceEntity;

    @Column({ type: 'int' })
    weekday: number;

    @Column({ name: 'start_time', type: 'varchar', length: 8 })
    startTime: string;

    @Column({ name: 'interval_weeks', type: 'int', default: 1 })
    intervalWeeks: number;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
