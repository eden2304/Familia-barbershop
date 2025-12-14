import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';
import { sanitizeString } from '../../../common/security.utils';

export class VerifyCodeDto {
    @IsString()
    @IsNotEmpty()
    @Matches(/^\+?\d{9,15}$/)
    @Transform(({ value }) => sanitizeString(value))
    phone: string;

    @IsString()
    @IsNotEmpty()
    @Length(4, 4)
    @Matches(/^\d{4}$/)
    @Transform(({ value }) => sanitizeString(value))
    code: string;

    @IsOptional()
    @IsString()
    @Length(1, 80)
    @Transform(({ value }) => sanitizeString(value))
    firstName?: string;

    @IsOptional()
    @IsString()
    @Length(1, 80)
    @Transform(({ value }) => sanitizeString(value))
    lastName?: string;

    @IsOptional()
    @IsBoolean()
    rememberMe?: boolean;
}
