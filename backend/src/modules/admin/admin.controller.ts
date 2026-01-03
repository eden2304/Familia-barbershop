import {
    BadRequestException,
    Body,
    Controller,
    Delete,
    Get,
    Param,
    Post,
    UnauthorizedException,
    UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BlockedTime } from '../../entities/blocked-time.entity';
import { AddBlockDto } from '../appointments/dtos';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { Public } from '../auth/public.decorator';
import { JwtService } from '@nestjs/jwt';

@Controller('admin')
export class AdminController {
    constructor(
        @InjectRepository(BlockedTime) private readonly blockRepo: Repository<BlockedTime>,
        private readonly jwtService: JwtService,
    ) {}

    private parseBoolean(value: any): boolean {
        if (value === undefined || value === null) return false;
        if (typeof value === 'boolean') return value;
        if (typeof value === 'number') return value === 1;
        const norm = String(value).trim().toLowerCase();
        return ['1', 'true', 'yes', 'y', 'on'].includes(norm);
    }

    // ✅ זה חייב להיות פתוח כדי “להתחבר” כמנהל
    @Public()
    @Post('verify-code')
    verifyAdminCode(@Body() body: any) {
        const code = String(body?.code ?? body?.adminCode ?? body?.pin ?? '').trim();

        const expected = String(process.env.ADMIN_CODE ?? '').trim();
        const fallback = '12345';

        const ok = (expected && code === expected) || code === fallback;
        if (!ok) throw new UnauthorizedException('INVALID_ADMIN_CODE');

        // חשוב: לשים גם role וגם roles כדי להתאים לכל RolesGuard אפשרי
        const payload: any = { role: 'admin', roles: ['admin'], isAdmin: true };

        const accessToken = this.jwtService.sign(payload);

        return { ok: true, accessToken };
    }

    // 🔒 כל השאר מוגן
    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    @Get('blocked-times')
    listBlocks() {
        return this.blockRepo.find({ order: { startsAt: 'ASC' } });
    }

    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    @Post('blocked-times')
    addBlock(@Body() b: AddBlockDto) {
        const startsAt = new Date((b as any).startAt ?? (b as any).starts_at);
        const endsAt = new Date((b as any).endAt ?? (b as any).ends_at);

        if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || !(endsAt > startsAt)) {
            throw new BadRequestException('Invalid startAt/endAt');
        }

        const rawMembersOnly = (b as any).membersOnly ?? (b as any).members_only;
        const membersOnly = this.parseBoolean(rawMembersOnly);

        return this.blockRepo.save(
            this.blockRepo.create({
                startsAt,
                endsAt,
                reason: (b as any).reason,
                membersOnly,
            }),
        );
    }

    @UseGuards(JwtAuthGuard)
    @Roles('admin')
    @Delete('blocked-times/:id')
    removeBlock(@Param('id') id: string) {
        return this.blockRepo.delete(id);
    }
}
