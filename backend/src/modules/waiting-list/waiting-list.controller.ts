import { Body, Controller, Post } from '@nestjs/common';
import { WaitingListService } from './waiting-list.service';
import { mapCreatePayload } from './waiting-list.mappers';

@Controller('waiting-list')
export class WaitingListController {
    constructor(private readonly svc: WaitingListService) {}

    @Post()
    async create(@Body() body: any) {
        const dto = mapCreatePayload(body);
        const entry = await this.svc.create(dto);
        return { ok: true, entry };
    }
}
