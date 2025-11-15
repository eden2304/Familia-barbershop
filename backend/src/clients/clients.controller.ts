import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ClientsService } from './clients.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { JwtAuthGuard } from '../modules/auth/jwt-auth.guard';
import { Roles } from '../modules/auth/roles.decorator';

@Controller('clients')
@UseGuards(JwtAuthGuard)
@Roles('admin')
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
