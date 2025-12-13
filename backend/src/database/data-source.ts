import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';

const dbUrl = process.env.DATABASE_URL;

if (process.env.NODE_ENV === 'production' && !dbUrl) {
    throw new Error('DATABASE_URL is required in production');
}

const AppDataSource = new DataSource({
    type: 'postgres',
    url: dbUrl || 'postgres://familia_app:change_me_strong@localhost:5432/familia',
    entities: [__dirname + '/../**/*.entity.{ts,js}'],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    synchronize: false,
    logging: false,
    namingStrategy: new SnakeNamingStrategy(),
});

export default AppDataSource;
