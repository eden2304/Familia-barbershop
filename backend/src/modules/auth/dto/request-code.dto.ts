import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { sanitizeString } from '../../../common/security.utils';

export class RequestCodeDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?\d{9,15}$/)
    @Transform(({ value }) => sanitizeString(value))
    phone: string;

    @IsOptional()
    @IsBoolean()
    rememberMe?: boolean;
}
