import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../users/user.entity';
import { BackupImage } from './backup-image.entity';
import { Backup } from './backup.entity';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Backup, BackupImage, User])],
  controllers: [BackupController],
  providers: [BackupService],
})
export class BackupModule {}