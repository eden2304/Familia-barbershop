import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// ... יבואי TypeORM קיימים

@Entity({ name: 'services' })
export class ServiceEntity {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    name: string;

    @Column({ name: 'duration_minutes', type: 'int' })
    durationMinutes: number;

    @Column({ type: 'int' })
    price: number;

    @Column({ name: 'order_index', type: 'int', default: 0 })
    orderIndex: number;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;
}

