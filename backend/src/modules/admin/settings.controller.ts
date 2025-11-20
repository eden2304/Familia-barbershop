import { Controller, Get, Post, Param, Body, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Setting } from '../../entities/setting.entity';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller()
export class SettingsController {
    constructor(@InjectRepository(Setting) private repo: Repository<Setting>) {}

    @Get('settings/:key')
    async getOne(@Param('key') key: string) {
        const row = await this.repo.findOne({ where: { key } });
        return row ?? null;
    }

    @Post('admin/settings/:key')
    @UseGuards(JwtAuthGuard)
    @Roles('admin')
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
