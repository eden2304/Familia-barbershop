import { IsNotEmpty, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(1024)
    p256dh!: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(512)
    auth!: string;
}

export class SubscribeAdminPushDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(4000)
    endpoint!: string;

    @ValidateNested()
    @Type(() => PushKeysDto)
    keys!: PushKeysDto;
}
