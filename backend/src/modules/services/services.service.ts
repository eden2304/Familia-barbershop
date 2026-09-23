import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ServiceEntity, SERVICE_COLOR_KEYS } from '../../entities/service.entity';
import { Repository } from 'typeorm';

// קוד שגיאת Postgres להפרת אילוץ ייחודיות (unique_violation)
const PG_UNIQUE_VIOLATION = '23505';

@Injectable()
export class ServicesService {
    constructor(@InjectRepository(ServiceEntity) private repo: Repository<ServiceEntity>) {}

    listActive() {
        return this.repo.find({ where: { isActive: true }, order: { orderIndex: 'ASC', name: 'ASC' } });
    }

    listAll() { return this.repo.find({ order: { orderIndex: 'ASC' } }); }

    private async assertColorAvailable(color: string, excludeId?: string) {
        if (!SERVICE_COLOR_KEYS.includes(color)) {
            throw new BadRequestException('יש לבחור צבע תקין מתוך רשימת הצבעים');
        }
        const existing = await this.repo.findOne({ where: { color } });
        // ה-id יכול להגיע כ-number (עמודת int בפרודקשן) או כ-string (UUID) - משווים כמחרוזות
        // כדי לא לתפוס בטעות שירות קיים כ"מתנגש" עם עצמו כשהוא שומר על הצבע שלו.
        if (existing && String(existing.id) !== String(excludeId)) {
            throw new ConflictException('הצבע הזה כבר בשימוש על ידי שירות אחר');
        }
    }

    // הופך הפרת אילוץ ייחודיות גולמית מה-DB (למשל שם כפול) לשגיאת 409 ברורה,
    // במקום 500 גנרי חסר הסבר.
    private rethrowKnownDbErrors(error: any): never {
        if (error?.code === PG_UNIQUE_VIOLATION) {
            if (String(error?.constraint || '').includes('name')) {
                throw new ConflictException('כבר קיים שירות עם השם הזה');
            }
            if (String(error?.constraint || '').includes('color')) {
                throw new ConflictException('הצבע הזה כבר בשימוש על ידי שירות אחר');
            }
            throw new ConflictException('הנתונים מתנגשים עם שירות קיים');
        }
        throw error;
    }

    async create(data: Partial<ServiceEntity>) {
        if (!data.color) {
            throw new BadRequestException('יש לבחור צבע לשירות');
        }
        await this.assertColorAvailable(data.color);
        try {
            return await this.repo.save(this.repo.create(data));
        } catch (error) {
            this.rethrowKnownDbErrors(error);
        }
    }

    async update(id: string, data: Partial<ServiceEntity>) {
        if (data.color !== undefined) {
            if (!data.color) {
                throw new BadRequestException('יש לבחור צבע לשירות');
            }
            await this.assertColorAvailable(data.color, id);
        }
        try {
            return await this.repo.update(id, data);
        } catch (error) {
            this.rethrowKnownDbErrors(error);
        }
    }

    remove(id: string) { return this.repo.delete(id); }
}
