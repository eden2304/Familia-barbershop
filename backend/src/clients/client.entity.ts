import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';

@Entity({ name: 'clients' })
export class Client {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({type: 'varchar', length: 80})
    first_name: string;

    @Column({type: 'varchar', length: 120, default: ''})
    last_name: string;

    @Index({unique: true})
    @Column({type: 'varchar', length: 20})
    phone: string; // normalized to Israeli leading 0

    @CreateDateColumn({type: 'timestamp with time zone'})
    created_at: Date;
}