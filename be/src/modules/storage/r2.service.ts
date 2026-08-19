import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

@Injectable()
export class R2Service {
  private readonly client: S3Client | null = null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const accountId = this.config.get<string>('R2_ACCOUNT_ID', '');
    const accessKeyId = this.config.get<string>('R2_ACCESS_KEY_ID', '');
    const secretAccessKey = this.config.get<string>('R2_SECRET_ACCESS_KEY', '');
    this.bucket = this.config.get<string>('R2_BUCKET', '');
    const endpoint = this.config.get<string>('R2_ENDPOINT', '');

    if (accountId && accessKeyId && secretAccessKey && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint: endpoint || `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  private requireClient(): S3Client {
    if (!this.client) {
      throw new ServiceUnavailableException('R2 storage chưa được cấu hình trên máy chủ');
    }
    return this.client;
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.requireClient().send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const response = await this.requireClient().send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new ServiceUnavailableException('Không đọc được object từ R2');
    }
    return Buffer.from(await response.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    try {
      await this.requireClient().send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    } catch (error) {
      // ignore missing objects
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes('NoSuchKey')) {
        throw error;
      }
    }
  }
}