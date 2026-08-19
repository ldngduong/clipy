import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { User } from '../users/user.entity';

@Entity('backup_images')
export class BackupImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('uq_backup_images_user_sha', { unique: true })
  @Column({ name: 'user_id', type: 'uuid' })
  userId: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ type: 'varchar' })
  sha256: string;

  @Index('uq_backup_images_object_key', { unique: true })
  @Column({ name: 'object_key', type: 'varchar' })
  objectKey: string;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;
}