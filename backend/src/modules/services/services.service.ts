import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ServiceEntity } from '../../entities/service.entity';
import { Repository } from 'typeorm';

@Injectable()
export class ServicesService {
    constructor(@InjectRepository(ServiceEntity) private repo: Repository<ServiceEntity>) {}

    listActive() {
        return this.repo.find({ where: { isActive: true }, order: { orderIndex: 'ASC', name: 'ASC' } });
    }

    listAll() { return this.repo.find({ order: { orderIndex: 'ASC' } }); }

    create(data: Partial<ServiceEntity>) { return this.repo.save(this.repo.create(data)); }
    update(id: string, data: Partial<ServiceEntity>) {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return Promise.resolve();
        return this.repo.update(numericId, data);
    }
    remove(id: string) {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) return Promise.resolve();
        return this.repo.delete(numericId);
    }
}
