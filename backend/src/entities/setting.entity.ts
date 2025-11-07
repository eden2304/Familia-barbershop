import { Column, Entity, PrimaryColumn } from 'typeorm';
@Entity('settings')
export class Setting {
    @PrimaryColumn({ length: 64 }) key: string;
    @Column('jsonb') value: any;
}
