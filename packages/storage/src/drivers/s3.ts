/**
 * S3-compatible driver: AWS S3, Cloudflare R2, MinIO.
 *
 * Objects are private. Access is always via a short-lived signed URL issued
 * after an authorization check — an object's key is never its permission.
 */
import { createHash } from 'node:crypto';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { assertSafeKey, safeDisplayFilename } from '../keys';
import {
  StorageError,
  type GetResult,
  type PutOptions,
  type SignedUrlOptions,
  type StorageDriver,
  type StoredObject,
} from '../types';

export interface S3DriverOptions {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Required for R2/MinIO; omit for AWS. */
  readonly endpoint?: string | undefined;
}

const DEFAULT_EXPIRY_SECONDS = 300;

export function createS3Driver(options: S3DriverOptions): StorageDriver {
  const client = new S3Client({
    region: options.region,
    credentials: {
      accessKeyId: options.accessKeyId,
      secretAccessKey: options.secretAccessKey,
    },
    ...(options.endpoint
      ? // R2 and MinIO require path-style addressing.
        { endpoint: options.endpoint, forcePathStyle: true }
      : {}),
  });

  return {
    name: 's3',
    isDurable: true,

    async put(put: PutOptions): Promise<StoredObject> {
      assertSafeKey(put.key);
      const body = Buffer.from(put.body);

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: options.bucket,
            Key: put.key,
            Body: body,
            ContentType: put.contentType,
            // Integrity check performed by the service on receipt.
            ChecksumSHA256: createHash('sha256').update(body).digest('base64'),
            ...(put.filename
              ? {
                  ContentDisposition: `attachment; filename="${safeDisplayFilename(put.filename)}"`,
                }
              : {}),
            ...(put.metadata ? { Metadata: put.metadata } : {}),
          }),
        );
      } catch (error) {
        throw new StorageError('DRIVER_ERROR', 'S3 upload failed', error);
      }

      return {
        key: put.key,
        size: body.byteLength,
        contentType: put.contentType,
        checksum: createHash('sha256').update(body).digest('hex'),
      };
    },

    async get(key: string): Promise<GetResult> {
      assertSafeKey(key);
      try {
        const result = await client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        const bytes = await result.Body!.transformToByteArray();
        const body = Buffer.from(bytes);
        return {
          body,
          contentType: result.ContentType ?? 'application/octet-stream',
          size: body.byteLength,
        };
      } catch (error) {
        if ((error as { name?: string }).name === 'NoSuchKey') {
          throw new StorageError('NOT_FOUND', `No object at ${key}`);
        }
        throw new StorageError('DRIVER_ERROR', 'S3 read failed', error);
      }
    },

    async delete(key: string): Promise<void> {
      assertSafeKey(key);
      try {
        await client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
      } catch (error) {
        throw new StorageError('DRIVER_ERROR', 'S3 delete failed', error);
      }
    },

    async exists(key: string): Promise<boolean> {
      assertSafeKey(key);
      try {
        await client.send(new HeadObjectCommand({ Bucket: options.bucket, Key: key }));
        return true;
      } catch {
        return false;
      }
    },

    async signedUrl(signed: SignedUrlOptions): Promise<string> {
      assertSafeKey(signed.key);
      const command = new GetObjectCommand({
        Bucket: options.bucket,
        Key: signed.key,
        ...(signed.downloadFilename
          ? {
              ResponseContentDisposition: `attachment; filename="${safeDisplayFilename(
                signed.downloadFilename,
              )}"`,
            }
          : {}),
      });
      return getSignedUrl(client, command, {
        expiresIn: signed.expiresInSeconds ?? DEFAULT_EXPIRY_SECONDS,
      });
    },
  };
}
