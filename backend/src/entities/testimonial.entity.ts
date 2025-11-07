import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from "typeorm";

@Entity({ name: "testimonials" })
export class Testimonial {
    @PrimaryGeneratedColumn()
    id: number;

    @Column({ type: "varchar", length: 200 })
    author: string;

    @Column({ type: "text" })
    text: string;

    @Column({ type: "int", default: 5 })
    rating: number;

    @Index()
    @Column({ type: "int", default: 0 })
    order_index: number;

    @Column({ type: "boolean", default: true })
    is_active: boolean;

    @CreateDateColumn({ type: "timestamp with time zone" })
    created_at: Date;

    @UpdateDateColumn({ type: "timestamp with time zone" })
    updated_at: Date;
}
