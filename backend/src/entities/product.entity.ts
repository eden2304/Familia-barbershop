import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'products' })
export class Product {
    @PrimaryGeneratedColumn('uuid') id: string;

    @Column({ type: 'varchar', length: 200 }) name: string;

    @Column({ type: 'integer' }) price: number;

    // ↓↓↓ שדות שחזרנו ↓↓↓
    @Column({ type: 'text', nullable: true }) imageUrl: string | null;

    @Column({ type: 'integer', default: 0 }) orderIndex: number;

    @Column({ type: 'boolean', default: true }) isActive: boolean;
}
