import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

export class SaveBackupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50 * 1024 * 1024)
  data: string;
}