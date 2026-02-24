import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';

@Entity({ name: 'business_hours_overrides' })
@Unique(['date'])
export class BusinessHoursOverride {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: 'date' })
    date: string; // YYYY-MM-DD

    @Column({ type: 'varchar', length: 8 })
    open: string;

    @Column({ type: 'varchar', length: 8 })
    close: string;

    @Column({ name: 'slot_interval_minutes', type: 'int', default: 30 })
    slotIntervalMinutes: number;
}
