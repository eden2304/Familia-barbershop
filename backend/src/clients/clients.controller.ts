import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
export class ClientsController {
    constructor(private readonly service: ClientsService) {}

    // GET /clients → עם תור אחרון (זה מה שה-UI שלך מצפה אליו)
    @Get()
    list() {
        return this.service.findAllWithLastAppointment();
    }

    // אופציונלי: אם אתה רוצה גם את הרשימה "הרגילה" בלי תור אחרון:
    @Get('raw')
    findAll() {
        return this.service.findAll();
    }

    @Post()
    create(@Body() dto: CreateClientDto) {
        return this.service.create(dto);
    }

    @Put(':id')
    update(@Param('id') id: string, @Body() dto: UpdateClientDto) {
        return this.service.update(id, dto);
    }

    @Delete(':id')
    remove(@Param('id') id: string) {
        return this.service.remove(id);
    }
}
