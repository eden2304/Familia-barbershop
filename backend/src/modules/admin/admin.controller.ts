import { BadRequestException, Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Repository } from 'typeorm';
import { AddBlockDto } from '../appointments/dtos';

@Controller('admin')
export class AdminController {
    constructor(
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
    ) {}

    @Get('blocked-times')
    listBlocks() {
        return this.blockRepo.find({ order: { startsAt: 'ASC' } });
    }

    @Post('blocked-times')
    addBlock(@Body() b: AddBlockDto) {
        const startsAt = new Date(b.startAt);
        const endsAt = new Date(b.endAt);
        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || !(endsAt > startsAt)) {
            throw new BadRequestException('Invalid startAt/endAt');
        }
        return this.blockRepo.save(this.blockRepo.create({ startsAt, endsAt, reason: b.reason }));
    }

    @Delete('blocked-times/:id')
    removeBlock(@Param('id') id: string) {
        return this.blockRepo.delete(id);
    }
}
