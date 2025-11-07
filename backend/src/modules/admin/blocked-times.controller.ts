import { Controller, Get, Post, Delete, Param, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockedTime } from '../../entities/blocked-time.entity';

@Controller('admin/blocked-times')
export class BlockedTimesController {
    constructor(@InjectRepository(BlockedTime) private repo: Repository<BlockedTime>) {}

    @Get()
    list() {
        // ✔ camelCase של ה-Entity
        return this.repo.find({ order: { startsAt: 'DESC' } });
    }

    @Post()
    async add(@Body() body: Partial<BlockedTime>) {
        const row = await this.repo.save(this.repo.create(body));
        return { id: row.id };
    }

    @Delete(':id')
    async remove(@Param('id') id: string) {
        await this.repo.delete({ id }); // ✔
        return { ok: true };
    }
}
