import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('admin_push_subscriptions')
@Index('idx_admin_push_subscriptions_admin_phone', ['adminPhone'])
export class AdminPushSubscription {
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ name: 'admin_phone', type: 'varchar', length: 32 })
    adminPhone!: string;

    @Column({ type: 'text', unique: true })
    endpoint!: string;

    @Column({ type: 'text' })
    p256dh!: string;

    @Column({ type: 'text' })
    auth!: string;

    @CreateDateColumn({ name: 'created_at' })
    createdAt!: Date;
}
