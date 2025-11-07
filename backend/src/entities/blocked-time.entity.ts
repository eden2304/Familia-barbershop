import { Column, Entity, PrimaryGeneratedColumn, Index } from 'typeorm';

@Entity({ name: 'blocked_times' })
export class BlockedTime {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ type: 'varchar', length: 255 })
    reason: string;

    @Column({ name: 'members_only', type: 'boolean', default: false })
    membersOnly: boolean;

    @Column({ name: 'starts_at', type: 'timestamptz' })
    startsAt: Date;

    @Column({ name: 'ends_at', type: 'timestamptz' })
    endsAt: Date;
}

