import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import type { Readable } from "node:stream";

/**
 * S3-compatible artifact storage (MinIO locally). The bucket is private:
 * artifacts are only served to authenticated operators through the web app.
 */

export interface StorageConfig {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
}

export interface StoredObject {
  key: string;
  sha256: string;
  byteSize: number;
}

const KEY_PATTERN = /^scans\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-z0-9-]+\.(png)$/;

/** Artifact keys are built only from server-generated UUIDs. */
export function screenshotKey(scanId: string, executionId: string): string {
  return artifactKey(scanId, executionId, "screenshot");
}

/** `name` is a fixed server-side label such as `screenshot`, `step-3`, or `diff`. */
export function artifactKey(scanId: string, executionId: string, name: string): string {
  const key = `scans/${scanId}/${executionId}/${name}.png`;
  if (!KEY_PATTERN.test(key)) throw new Error("Refusing to build an artifact key from unexpected identifiers");
  return key;
}

const VERIFICATION_KEY_PATTERN = /^repairs\/[0-9a-f-]{36}\/verifications\/[0-9a-f-]{36}\/[a-z0-9-]+\.png$/;

/** Screenshot of one verification check; built only from server-generated UUIDs. */
export function verificationArtifactKey(repairId: string, runId: string, checkId: string): string {
  const key = `repairs/${repairId}/verifications/${runId}/${checkId}.png`;
  if (!VERIFICATION_KEY_PATTERN.test(key)) throw new Error("Refusing to build a verification artifact key from unexpected identifiers");
  return key;
}

function isArtifactKey(key: string): boolean {
  return KEY_PATTERN.test(key) || VERIFICATION_KEY_PATTERN.test(key);
}

export class ArtifactStorage {
  readonly client: S3Client;
  readonly bucket: string;

  constructor(config: StorageConfig) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    });
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status !== 404 && (error as Error).name !== "NotFound") throw error;
      await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    if (!isArtifactKey(key)) throw new Error(`Invalid artifact key: ${key}`);
    const sha256 = createHash("sha256").update(body).digest("hex");
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.length,
        ChecksumSHA256: createHash("sha256").update(body).digest("base64"),
        Metadata: { sha256 },
      }),
    );
    return { key, sha256, byteSize: body.length };
  }

  async get(key: string): Promise<{ body: Readable; contentLength?: number; contentType?: string }> {
    if (!isArtifactKey(key)) throw new Error(`Invalid artifact key: ${key}`);
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return { body: result.Body as Readable, contentLength: result.ContentLength, contentType: result.ContentType };
  }

  async getBuffer(key: string): Promise<Buffer> {
    const { body } = await this.get(key);
    const chunks: Buffer[] = [];
    for await (const chunk of body) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
  }
}

export function storageConfigFromEnv(env: {
  S3_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET: string;
  S3_ACCESS_KEY_ID: string;
  S3_SECRET_ACCESS_KEY: string;
  S3_FORCE_PATH_STYLE: boolean;
}): StorageConfig {
  return {
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    bucket: env.S3_BUCKET,
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  };
}
