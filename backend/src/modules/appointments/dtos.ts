import { IsISO8601, IsNotEmpty, IsOptional, IsPhoneNumber, IsString, IsUUID, Matches, MinLength } from 'class-validator';

export class CreateAppointmentDto {
    @IsString()
    @Matches(/^\d{7,15}$/) // ספרות בלבד 7-15
    clientPhone: string;

    @IsString() @MinLength(1)
    clientFirstName: string;

    @IsString() @MinLength(1)
    clientLastName: string;

    @IsUUID()
    serviceId: string;

    @IsISO8601()
    startsAt: string; // ISO (כולל אזור זמן)

    @IsOptional()
    @IsString()
    note?: string;
}

export class GetAvailableQuery {
    @IsUUID()
    serviceId: string;

    // YYYY-MM-DD
    @Matches(/^\d{4}-\d{2}-\d{2}$/)
    date: string;
}

export class MyAppointmentsQuery {
    @Matches(/^\d{7,15}$/)
    phone: string;
}

export class AddBlockDto {
    @IsISO8601()
    startAt: string;

    @IsISO8601()
    endAt: string;

    @IsOptional()
    @IsString()
    reason?: string;
}
