import { IsNotEmpty, IsString, Length, Matches } from 'class-validator';

export class CreateClientDto {
    @IsString() @IsNotEmpty() @Length(1, 80)
    first_name: string;

    @IsString() @Length(0, 120)
    last_name: string;

// 0XXXXXXXXX – normalized (we’ll normalize server-side as well)
    @IsString() @Matches(/^0\d{8,9}$/)
    phone: string;
}