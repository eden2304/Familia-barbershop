import { IsObject, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

class PushKeysDto {
    @IsString()
    p256dh!: string;

    @IsString()
    auth!: string;
}

class BrowserPushSubscriptionDto {
    @IsString()
    endpoint!: string;

    @IsObject()
    @ValidateNested()
    @Type(() => PushKeysDto)
    keys!: PushKeysDto;
}

export class SubscribePushDto {
    @IsObject()
    @ValidateNested()
    @Type(() => BrowserPushSubscriptionDto)
    subscription!: BrowserPushSubscriptionDto;
}

export class UnsubscribePushDto {
    @IsOptional()
    @IsString()
    endpoint?: string;

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => BrowserPushSubscriptionDto)
    subscription?: BrowserPushSubscriptionDto;
}
