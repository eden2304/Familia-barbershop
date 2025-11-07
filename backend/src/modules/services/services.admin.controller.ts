import { Controller, Get, Post, Put, Delete, Param, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceEntity } from '../../entities/service.entity';

@Controller('admin/services')
export class AdminServicesController {
    constructor(@InjectRepository(ServiceEntity) private repo: Repository<ServiceEntity>) {}

    @Get()
    list() {
        // ✔ camelCase בשדות ה-Entity:
        return this.repo.find({ order: { orderIndex: 'ASC', id: 'ASC' } });
    }

    @Post()
    create(@Body() dto: Partial<ServiceEntity>) {
        return this.repo.save(this.repo.create(dto));
    }

    @Put(':id')
    async update(@Param('id') id: string, @Body() dto: Partial<ServiceEntity>) {
        // ✔ אל תעשה Number(id) — ה-id שלך טיפוס string (UUID)
        await this.repo.update({ id }, dto);
        return this.repo.findOne({ where: { id } });
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        await this.repo.delete({ id });
        return { ok: true };
    }
}
