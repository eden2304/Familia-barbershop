import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'gallery_videos' })
export class GalleryVideo {
    @PrimaryGeneratedColumn('uuid') id: string;

    // ↓↓↓ שדות מדיה שחזרנו ↓↓↓
    @Column({ type: 'text' }) videoUrl: string;

    @Column({ type: 'integer', default: 0 }) orderIndex: number;

    @Column({ type: 'boolean', default: true }) isActive: boolean;
}

