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

    @Column({ type: 'boolean', name: 'is_member', default: false })
    is_member: boolean;

    get isMember(): boolean {
        return this.is_member;
    }

    set isMember(value: boolean) {
        this.is_member = value;
    }

    @CreateDateColumn({type: 'timestamp with time zone'})
    created_at: Date;
}
