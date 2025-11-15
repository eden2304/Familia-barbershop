import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import { WaitingListService } from './waiting-list.service';
import { mapCreatePayload, mapUpdatePayload, parseStatusFilter } from './waiting-list.mappers';

@Controller('admin/waiting-list')
export class WaitingListAdminController {
    constructor(private readonly svc: WaitingListService) {}

    @Get()
    async list(
        @Query('status') status?: string,
        @Query('date') date?: string,
        @Query('serviceId') serviceId?: string,
    ) {
        const statuses = parseStatusFilter(status);
        return this.svc.list({ statuses, date, serviceId });
    }

    @Post()
    async create(@Body() body: any) {
        const dto = mapCreatePayload(body);
        return this.svc.create(dto);
    }

    @Put(':id')
    async update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: any) {
        const patch = mapUpdatePayload(body);
        return this.svc.update(id, patch);
    }

    @Delete(':id')
    async remove(@Param('id', new ParseUUIDPipe()) id: string) {
        await this.svc.remove(id);
        return { ok: true };
    }
}
