import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceEntity } from '../../entities/service.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin/services')
@UseGuards(JwtAuthGuard)
@Roles('admin')
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
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) {
            return null;
        }
        await this.repo.update({ id: numericId }, dto);
        return this.repo.findOne({ where: { id: numericId } });
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        const numericId = Number(id);
        if (!Number.isFinite(numericId)) {
            return { ok: false };
        }
        await this.repo.delete({ id: numericId });
        return { ok: true };
    }
}
