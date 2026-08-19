import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { join } from 'path';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.getOrThrow<string>('DATABASE_HOST'),
        port: config.getOrThrow<number>('DATABASE_PORT'),
        username: config.getOrThrow<string>('DATABASE_USER'),
        password: config.getOrThrow<string>('DATABASE_PASSWORD'),
        database: config.getOrThrow<string>('DATABASE_NAME'),
        ssl: config.get<boolean>('DATABASE_SSL') === true,
        autoLoadEntities: true,
        synchronize: config.get<boolean>('TYPEORM_SYNC') === true,
        migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
      }),
    }),
  ],
})
export class DatabaseModule {}