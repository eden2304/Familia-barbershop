import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ServicesService } from './services.service';
import { ServiceEntity } from '../../entities/service.entity';
import {Public} from "../auth/public.decorator";

@Controller()
export class ServicesController {
    constructor(private readonly svc: ServicesService) {}

    @Public()
    @Get('services')
    getActive() { return this.svc.listActive(); }

    // Admin (כרגע ללא Guard כדי לא לשבור UI)
    @Get('admin/services')
    getAllAdmin() { return this.svc.listAll(); }

    @Post('admin/services')
    create(@Body() body: Partial<ServiceEntity>) { return this.svc.create(body); }

    @Put('admin/services/:id')
    update(@Param('id') id: string, @Body() body: Partial<ServiceEntity>) {
        return this.svc.update(id, body);
    }

    @Delete('admin/services/:id')
    remove(@Param('id') id: string) { return this.svc.remove(id); }
}
