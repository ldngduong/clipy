import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Put,
  Query,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { IsString, IsNotEmpty, Matches, MaxLength } from 'class-validator';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtAuthGuard } from '../../common/guards/auth.guards';
import { User } from '../users/user.entity';
import { BackupService } from './backup.service';
import { SaveBackupDto } from './dto/save-backup.dto';

class UploadImageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(50 * 1024 * 1024)
  base64: string;
}

class ShaParam {
  @Matches(/^[0-9a-f]{64}$/)
  sha: string;
}

@ApiTags('backup')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get()
  @ApiOperation({ summary: 'Get the most recent backup snapshot' })
  get(@CurrentUser('id') userId: string) {
    return this.backupService.get(userId);
  }

  @Get('collections')
  @ApiOperation({ summary: 'Collection names + item counts of the latest backup (for selection)' })
  collections(@CurrentUser('id') userId: string) {
    return this.backupService.collectionsSummary(userId);
  }

  @Get('restore')
  @ApiOperation({ summary: 'Restore payload filtered to the given collections' })
  restore(
    @CurrentUser('id') userId: string,
    @Query('collections') collections: string | string[] | undefined,
  ) {
    const names = (Array.isArray(collections) ? collections : [collections ?? ''])
      .flatMap((c) => String(c).split(','))
      .map((c) => c.trim())
      .filter(Boolean);
    return this.backupService.restore(userId, names.length > 0 ? names : null);
  }

  @Get('quota')
  @ApiOperation({ summary: 'Image backup quota usage for the current user' })
  quota(@CurrentUser('id') userId: string) {
    return this.backupService.quota(userId);
  }

  @Put()
  @ApiOperation({ summary: 'Save the most recent backup snapshot (overwrites)' })
  save(@CurrentUser('id') userId: string, @Body() dto: SaveBackupDto) {
    return this.backupService.save(userId, dto.data);
  }

  @Put('images/:sha')
  @ApiOperation({ summary: 'Upload one backup image (JSON base64); stored as WebP' })
  uploadImage(
    @CurrentUser('id') userId: string,
    @Param() params: ShaParam,
    @Body() dto: UploadImageDto,
  ) {
    return this.backupService.uploadImage(userId, params.sha, dto.base64);
  }

  @Get('images/:sha')
  @ApiOperation({ summary: 'Download one backup image as PNG' })
  @Header('Cache-Control', 'no-store')
  async getImage(
    @CurrentUser('id') userId: string,
    @Param('sha') sha: string,
    @Res({ passthrough: true }) res,
  ) {
    const { bytes, contentType } = await this.backupService.getImage(userId, sha);
    (res as Response).set({ 'Content-Type': contentType, 'Content-Length': bytes.length });
    return new StreamableFile(bytes);
  }
}