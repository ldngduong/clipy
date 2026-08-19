import 'dotenv/config';
import { DataSource } from 'typeorm';
import { join } from 'path';

export const dataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: Number(process.env.DATABASE_PORT ?? 5432),
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  ssl: process.env.DATABASE_SSL === 'true',
  entities: [join(__dirname, '..', 'modules', '**', '*.entity.ts')],
  migrations: [join(__dirname, 'migrations', '*.ts')],
});