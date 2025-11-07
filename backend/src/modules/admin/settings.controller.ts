import { Controller, Get, Post, Param, Body } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';

@Controller()
export class SettingsController {
    constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

    @Get('settings/:key')
    async getOne(@Param('key') key: string) {
        const row = await this.repo.findOne({ where: { key } });
        return row ?? null;
    }

    @Post('admin/settings/:key')
    async setOne(@Param('key') key: string, @Body() body: { value?: string }) {
        const existing = await this.repo.findOne({ where: { key } });
        const value = body?.value ?? null;
        if (existing) {
            existing.value = value as any;
            return this.repo.save(existing);
        }
        return this.repo.save(this.repo.create({ key, value: value as any }));
    }
}
