import { Column, Entity, PrimaryGeneratedColumn, Unique } from 'typeorm';
@Entity('admin_phones')
@Unique(['phone'])
export class AdminPhone {
    @PrimaryGeneratedColumn('uuid') id: string;
    @Column({ length: 20 }) phone: string;
}
