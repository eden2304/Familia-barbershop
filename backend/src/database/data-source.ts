// src/database/data-source.ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

// אל תייצא את האובייקט בשם; שמור אותו מקומי בלבד
const AppDataSource = new DataSource({
    type: 'postgres',
    url: process.env.DATABASE_URL || 'postgres://familia:familia@localhost:5432/familia',
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: false,
    logging: false,
    namingStrategy: new SnakeNamingStrategy(),
});

// ייצוא יחיד כנדרש ע"י ה-CLI
export default AppDataSource;
