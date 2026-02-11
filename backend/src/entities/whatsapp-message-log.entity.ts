import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity({ name: 'whatsapp_message_logs' })
export class WhatsAppMessageLog {
    @PrimaryGeneratedColumn('uuid')
    id: string;

    @Column({ name: 'to_phone', type: 'varchar', length: 32 })
    toPhone: string;

    @Column({ name: 'template_name', type: 'varchar', length: 128 })
    templateName: string;

    @Column({ name: 'payload_json', type: 'jsonb' })
    payloadJson: Record<string, any>;

    @Column({ name: 'status', type: 'varchar', length: 32 })
    status: string;

    @Column({ name: 'meta_message_id', type: 'varchar', length: 128, nullable: true })
    metaMessageId: string | null;

    @Column({ name: 'error', type: 'text', nullable: true })
    error: string | null;

    @Column({ name: 'appointment_id', type: 'uuid', nullable: true })
    appointmentId: string | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt: Date;
}
