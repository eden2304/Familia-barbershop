import { Controller, Get, Post, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ServiceEntity } from '../../entities/service.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

// Note: this controller is currently shadowed by ServicesController's admin/services routes
// (registered first in services.module.ts), so create/update validation lives there instead.
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
