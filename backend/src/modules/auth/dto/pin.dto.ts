import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';
import { sanitizeString } from '../../../common/security.utils';

export class PinLoginDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?\d{9,15}$/)
    @Transform(({ value }) => sanitizeString(value))
    phone: string;

    @IsString()
    @Matches(/^\d{4,6}$/)
    pin: string;

    @IsOptional()
    @IsBoolean()
    rememberMe?: boolean;
}

export class SetPinDto {
    @IsString()
    @Matches(/^\d{4,6}$/)
    pin: string;
}
