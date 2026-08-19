import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { In, Repository } from 'typeorm';
import { R2Service } from '../storage/r2.service';
import { User } from '../users/user.entity';
import { BackupImage } from './backup-image.entity';
import { Backup } from './backup.entity';

const FREE_MAX_COLLECTIONS = 10;
const FREE_MAX_BYTES = 10 * 1024 * 1024;
const PRO_MAX_JSON_BYTES = 50 * 1024 * 1024;
export const PRO_MAX_IMAGE_BYTES = 1024 * 1024 * 1024; // 1GB

export interface BackupMeta {
  items: number;
  collections: number;
  storageBytes: number;
  updatedAt: string;
}

@Injectable()
export class BackupService {
  constructor(
    @InjectRepository(Backup)
    private readonly repo: Repository<Backup>,
    @InjectRepository(User)
    private readonly users: Repository<User>,
    @InjectRepository(BackupImage)
    private readonly images: Repository<BackupImage>,
    private readonly r2: R2Service,
  ) {}

  private async quotaUsed(userId: string): Promise<number> {
    const row = await this.images
      .createQueryBuilder('bi')
      .select('COALESCE(SUM(bi.size_bytes), 0)', 'total')
      .where('bi.user_id = :userId', { userId })
      .getRawOne<{ total: string }>();
    return Number(row?.total ?? 0);
  }

  private keyFor(userId: string, sha: string): string {
    return `backups/${userId}/${sha}.webp`;
  }

  async get(userId: string): Promise<{ data: unknown; meta: BackupMeta }> {
    return this.restore(userId, null);
  }

  /**
   * Lightweight summary of the latest backup — collection names with the
   * number of (restorable) clipboard items inside each, so the client can
   * let the user pick collections without downloading the full snapshot.
   */
  async collectionsSummary(
    userId: string,
  ): Promise<{ collections: { name: string; itemCount: number }[]; pinned: number }> {
    const backup = await this.repo.findOne({ where: { userId } });
    if (!backup) {
      throw new NotFoundException('Chưa có bản sao lưu nào');
    }
    const snapshot = this.parseData(backup.data) as {
      collections?: { name?: unknown }[];
      items?: { kind?: string; collections?: string[] }[];
    };
    if (!snapshot || typeof snapshot !== 'object') {
      throw new BadRequestException('Dữ liệu sao lưu không hợp lệ');
    }
    const counts = new Map<string, number>();
    let pinned = 0;
    for (const item of Array.isArray(snapshot.items) ? snapshot.items : []) {
      if (item?.kind === 'IMAGE') continue;
      const names = Array.isArray(item.collections) ? item.collections : [];
      if (names.length === 0) {
        pinned++;
        continue;
      }
      for (const name of names) {
        counts.set(name, (counts.get(name) ?? 0) + 1);
      }
    }
    return {
      collections: (Array.isArray(snapshot.collections) ? snapshot.collections : [])
        .map((c) => ({ name: String(c?.name ?? ''), itemCount: 0 }))
        .filter((c) => c.name.length > 0)
        .map((c) => ({ ...c, itemCount: counts.get(c.name) ?? 0 })),
      pinned,
    };
  }

  /**
   * Full restore payload — either the whole snapshot (collectionNames = null)
   * or only the requested collections plus always-kept pinned items. Image
   * items are stripped for non-Pro plans.
   */
  async restore(
    userId: string,
    collectionNames: string[] | null,
  ): Promise<{ data: unknown; meta: BackupMeta }> {
    const backup = await this.repo.findOne({ where: { userId } });
    if (!backup) {
      throw new NotFoundException('Chưa có bản sao lưu nào');
    }
    const user = await this.users.findOne({ where: { id: userId } });
    const snapshot = this.parseData(backup.data) as {
      collections?: unknown[];
      items?: (Record<string, unknown> & { kind?: string; collections?: string[] })[];
    };
    if (!snapshot || typeof snapshot !== 'object') {
      throw new BadRequestException('Dữ liệu sao lưu không hợp lệ');
    }

    const all = collectionNames === null;
    const names = new Set(collectionNames ?? []);
    if (!all && names.size > FREE_MAX_COLLECTIONS) {
      throw new BadRequestException(
        `Chỉ được khôi phục tối đa ${FREE_MAX_COLLECTIONS} bộ sưu tập`,
      );
    }

    const collections = Array.isArray(snapshot.collections) ? snapshot.collections : [];
    const keptCollections = all
      ? collections
      : collections.filter((c) =>
          names.has(String((c as { name?: unknown })?.name ?? '')),
        );
    const keptItems = Array.isArray(snapshot.items)
      ? snapshot.items.filter((it) => {
          if (it?.kind === 'IMAGE') return user?.plan === 'pro';
          if (!all) {
            if (!Array.isArray(it.collections) || it.collections.length === 0) {
              return true;
            }
            return it.collections.every((n) => names.has(n));
          }
          return true;
        })
      : [];
    const data = { ...snapshot, collections: keptCollections, items: keptItems };

    return {
      data,
      meta: {
        items: keptItems.length,
        collections: keptCollections.length,
        storageBytes: await this.quotaUsed(userId),
        updatedAt: backup.updatedAt.toISOString(),
      },
    };
  }

  private parseData(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  async quota(userId: string): Promise<{ usedBytes: number; limitBytes: number }> {
    const user = await this.users.findOne({ where: { id: userId } });
    return {
      usedBytes: await this.quotaUsed(userId),
      limitBytes: user?.plan === 'pro' ? PRO_MAX_IMAGE_BYTES : 0,
    };
  }

  async save(
    userId: string,
    payload: string,
  ): Promise<{ items: number; collections: number; updatedAt: string }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }

    let parsed: { items?: unknown[]; collections?: unknown[] };
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new BadRequestException('Dữ liệu sao lưu không hợp lệ');
    }
    if (typeof parsed !== 'object' || parsed === null) {
      throw new BadRequestException('Dữ liệu sao lưu không hợp lệ');
    }
    const items = Array.isArray(parsed.items) ? parsed.items.length : 0;
    const collections = Array.isArray(parsed.collections) ? parsed.collections.length : 0;
    const imageItems = (parsed.items ?? []).filter(
      (it): it is { kind: string; image_key?: string } =>
        typeof it === 'object' && it !== null && (it as { kind?: string }).kind === 'IMAGE',
    );
    const byteLength = Buffer.byteLength(payload, 'utf8');

    if (user.plan === 'pro') {
      if (byteLength > PRO_MAX_JSON_BYTES) {
        throw new PayloadTooLargeException('Bản sao lưu quá lớn');
      }
    } else {
      if (collections > FREE_MAX_COLLECTIONS) {
        throw new ForbiddenException(
          `Gói Free chỉ được sao lưu tối đa ${FREE_MAX_COLLECTIONS} bộ sưu tập — nâng cấp Pro để không giới hạn`,
        );
      }
      if (imageItems.length > 0) {
        throw new ForbiddenException('Ảnh chỉ được sao lưu ở gói Pro');
      }
      if (byteLength > FREE_MAX_BYTES) {
        throw new PayloadTooLargeException('Bản sao lưu quá lớn');
      }
    }

    // Two-way binding: delete images on R2 (and quota rows) that are no
    // longer referenced by the newest backup snapshot.
    const referencedShas = new Set(
      imageItems
        .map((it) => (typeof it.image_key === 'string' ? it.image_key : ''))
        .filter((sha) => sha.length > 0),
    );
    const stored = await this.images.find({ where: { userId } });
    const orphans = stored.filter((img) => !referencedShas.has(img.sha256));
    for (const orphan of orphans) {
      await this.r2.delete(orphan.objectKey).catch(() => undefined);
    }
    if (orphans.length > 0) {
      await this.images.delete({ userId, sha256: In(orphans.map((o) => o.sha256)) });
    }

    const existing = await this.repo.findOne({ where: { userId } });
    const backup = existing ?? this.repo.create({ userId, data: '', items: 0, collections: 0 });
    backup.data = payload;
    backup.items = items;
    backup.collections = collections;
    const saved = await this.repo.save(backup);
    return {
      items: saved.items,
      collections: saved.collections,
      updatedAt: saved.updatedAt.toISOString(),
    };
  }

  async uploadImage(
    userId: string,
    sha: string,
    base64: string,
  ): Promise<{ key: string; sizeBytes: number }> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException('Không tìm thấy người dùng');
    }
    if (user.plan !== 'pro') {
      throw new ForbiddenException('Ảnh chỉ được sao lưu ở gói Pro');
    }
    if (!this.r2.enabled) {
      throw new ServiceUnavailableException('R2 storage chưa được cấu hình trên máy chủ');
    }
    if (!/^[a-f0-9]{64}$/.test(sha)) {
      throw new BadRequestException('sha256 không hợp lệ');
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(base64, 'base64');
    } catch {
      throw new BadRequestException('base64 không hợp lệ');
    }
    if (bytes.length === 0) {
      throw new BadRequestException('Body rỗng');
    }
    const actualSha = createHash('sha256').update(bytes).digest('hex');
    if (actualSha !== sha) {
      throw new BadRequestException('Nội dung ảnh không khớp sha256');
    }

    const existing = await this.images.findOne({ where: { userId, sha256: sha } });
    if (existing) {
      return { key: existing.objectKey, sizeBytes: existing.sizeBytes };
    }

    const used = await this.quotaUsed(userId);
    const webp = await this.toWebp(bytes);
    if (used + webp.length > PRO_MAX_IMAGE_BYTES) {
      throw new PayloadTooLargeException('Dung lượng ảnh sao lưu vượt quá 1GB của gói Pro');
    }

    const objectKey = this.keyFor(userId, sha);
    await this.r2.put(objectKey, webp, 'image/webp');
    const saved = await this.images.save(
      this.images.create({
        userId,
        sha256: sha,
        objectKey,
        sizeBytes: webp.length,
      }),
    );
    return { key: saved.objectKey, sizeBytes: saved.sizeBytes };
  }

  async getImage(userId: string, sha: string): Promise<{ bytes: Buffer; contentType: string }> {
    const row = await this.images.findOne({ where: { userId, sha256: sha } });
    if (!row) {
      throw new NotFoundException('Ảnh không tồn tại trong bản sao lưu');
    }
    const webp = await this.r2.get(row.objectKey);
    // restore serves PNG so the desktop app can put the image back on the
    // clipboard without needing WebP decoding support
    const png = await this.toPng(webp);
    return { bytes: png, contentType: 'image/png' };
  }

  private async toWebp(bytes: Buffer): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    try {
      return await sharp(bytes).rotate().webp({ quality: 95, effort: 4 }).toBuffer();
    } catch {
      throw new BadRequestException('Ảnh không hợp lệ');
    }
  }

  private async toPng(bytes: Buffer): Promise<Buffer> {
    const sharp = (await import('sharp')).default;
    return sharp(bytes).png().toBuffer();
  }
}