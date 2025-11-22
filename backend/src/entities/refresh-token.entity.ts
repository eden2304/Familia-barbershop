import { Column, CreateDateColumn, Entity, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Client } from '../clients/client.entity';

@Entity('refresh_tokens')
export class RefreshToken {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column()
    tokenHash: string;

    @Column({ type: 'timestamp with time zone' })
    expiresAt: Date;

    @CreateDateColumn({ type: 'timestamp with time zone' })
    createdAt: Date;

    @Column({ type: 'timestamp with time zone', nullable: true })
    revokedAt?: Date | null;

    @ManyToOne(() => Client, { onDelete: 'CASCADE' })
    client: Client;

    @Column({ nullable: true })
    userAgent?: string;
}
