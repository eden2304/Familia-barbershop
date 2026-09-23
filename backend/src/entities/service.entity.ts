import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

// ... יבואי TypeORM קיימים

// פלטת צבעים סגורה לשירותים - חייבת להישאר בסנכרון עם SERVICE_COLOR_OPTIONS בפרונט (Admin.jsx)
export const SERVICE_COLOR_KEYS = ['sky', 'amber', 'violet', 'rose', 'emerald', 'pink', 'black', 'forest'];

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

    // מפתח מתוך פלטת צבעים קבועה (ראו SERVICE_COLOR_KEYS) - ייחודי בין שירותים
    @Column({ type: 'varchar', length: 16, nullable: true })
    color: string | null;
}

