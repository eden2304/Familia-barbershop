import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'business_hours' })
export class BusinessHour {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'int' })
    weekday: number; // 0=Sunday ... 6=Saturday

    @Column({ type: 'varchar', length: 8 })
    open: string; // 'HH:MM'

    @Column({ type: 'varchar', length: 8 })
    close: string; // 'HH:MM'

    @Column({ name: 'slot_interval_minutes', type: 'int', default: 30 })
    slotIntervalMinutes: number;
}

