import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

@Entity('push_subscriptions')
@Index(['endpoint'], { unique: true })
@Index(['phone', 'endpoint'], { unique: true })
export class PushSubscription {
    @PrimaryGeneratedColumn('increment')
    id!: number;

    @Column({ type: 'varchar', length: 32 })
    phone!: string;

    @Column({ type: 'text' })
    endpoint!: string;

    @Column({ type: 'text' })
    p256dh!: string;

    @Column({ type: 'text' })
    auth!: string;

    @Column({ type: 'text', nullable: true })
    userAgent!: string | null;

    @CreateDateColumn({ type: 'timestamptz' })
    createdAt!: Date;

    @UpdateDateColumn({ type: 'timestamptz' })
    lastSeenAt!: Date;
}
