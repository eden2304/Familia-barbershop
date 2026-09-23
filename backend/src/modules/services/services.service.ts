import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ServiceEntity, SERVICE_COLOR_KEYS } from '../../entities/service.entity';
import { Repository } from 'typeorm';

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
        if (existing && existing.id !== excludeId) {
            throw new ConflictException('הצבע הזה כבר בשימוש על ידי שירות אחר');
        }
    }

    async create(data: Partial<ServiceEntity>) {
        if (!data.color) {
            throw new BadRequestException('יש לבחור צבע לשירות');
        }
        await this.assertColorAvailable(data.color);
        return this.repo.save(this.repo.create(data));
    }

    async update(id: string, data: Partial<ServiceEntity>) {
        if (data.color !== undefined) {
            if (!data.color) {
                throw new BadRequestException('יש לבחור צבע לשירות');
            }
            await this.assertColorAvailable(data.color, id);
        }
        return this.repo.update(id, data);
    }

    remove(id: string) { return this.repo.delete(id); }
}
