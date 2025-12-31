import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UnauthorizedException,
    UseGuards
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { Repository } from 'typeorm';
import { AddBlockDto } from '../appointments/dtos';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';

@Controller('admin')
@UseGuards(JwtAuthGuard)
@Roles('admin')
export class AdminController {
    constructor(
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
    ) {}

    private parseBoolean(value: any): boolean {
        if (value === undefined || value === null) return false;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        const norm = String(value).trim().toLowerCase();
        return ['1', 'true', 'yes', 'y', 'on'].includes(norm);
    }

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
        const rawMembersOnly = (b as any).membersOnly ?? (b as any).members_only;
        const membersOnly = this.parseBoolean(rawMembersOnly);
        return this.blockRepo.save(this.blockRepo.create({ startsAt, endsAt, reason: b.reason, membersOnly }));
    }

    @Delete('blocked-times/:id')
    removeBlock(@Param('id') id: string) {
        return this.blockRepo.delete(id);
    }

    @Post('verify-code')
    verifyAdminCode(@Body() body: any) {
        const code = String(body?.code ?? body?.adminCode ?? body?.pin ?? '').trim();

        // 1) Prefer explicit ADMIN_CODE if you use it
        const expected = String(process.env.ADMIN_CODE ?? '').trim();

        // 2) Fallback to your known code (if you still use 12345 in the UI)
        const fallback = '12345';

        const ok = (expected && code === expected) || code === fallback;

        if (!ok) {
            throw new UnauthorizedException('INVALID_ADMIN_CODE');
        }

        return { ok: true };
    }

}
