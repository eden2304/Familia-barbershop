import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
    const app = await NestFactory.create(AppModule);

    // CORS אם צריך לפרונט
    app.enableCors({ origin: true, credentials: true });

    // ולידציה גלובלית
    app.useGlobalPipes(new ValidationPipe({
        whitelist: true,          // זורק שדות לא ידועים
        forbidNonWhitelisted: true,
        transform: true,          // ממיר טיפוסים (מספרים/תאריכים)
    }));

    await app.listen(process.env.PORT || 3001);
    // eslint-disable-next-line no-console
    console.log(`API listening on http://localhost:${process.env.PORT || 3001}`);
}
bootstrap();
