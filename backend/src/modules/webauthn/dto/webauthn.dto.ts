import { Transform } from 'class-transformer';
import {
    IsBoolean,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    Length,
    Matches,
} from 'class-validator';
import { sanitizeString } from '../../../common/security.utils';

export class WebauthnLoginOptionsDto {
    @IsOptional()
    @IsString()
    @Matches(/^\+?\d{9,15}$/)
    @Transform(({ value }) => sanitizeString(value))
    phone?: string;
}

export class WebauthnRegisterVerifyDto {
    @IsString()
    @IsNotEmpty()
    @Length(10, 200)
    challengeId: string;

    // Raw PublicKeyCredential JSON produced by @simplewebauthn/browser.
    @IsObject()
    response: Record<string, any>;

    @IsOptional()
    @IsString()
    @Length(1, 120)
    @Transform(({ value }) => sanitizeString(value))
    deviceLabel?: string;
}

export class WebauthnLoginVerifyDto {
    @IsString()
    @IsNotEmpty()
    @Length(10, 200)
    challengeId: string;

    @IsObject()
    response: Record<string, any>;

    @IsOptional()
    @IsBoolean()
    rememberMe?: boolean;
}
