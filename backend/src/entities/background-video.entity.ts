import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity({ name: 'background_videos' })
export class BackgroundVideo {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    // מיפוי לשם העמודה הקיים בטבלה
    @Column({ name: 'url', type: 'text' })
    videoUrl: string;

    @Column({ name: 'is_active', type: 'boolean', default: true })
    isActive: boolean;

    @Column({ name: 'order_index', type: 'integer', default: 0 })
    orderIndex: number;
}
