import 'dotenv/config';
import { DataSource } from 'typeorm';
import { entities } from './entities';
import { shouldUseDatabaseSsl } from './ssl';

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  entities,
  synchronize: process.env.TYPEORM_SYNC === 'true',
  logging: process.env.TYPEORM_LOGGING === 'true',
  ssl: shouldUseDatabaseSsl() ? { rejectUnauthorized: false } : false,
});

export default AppDataSource;
