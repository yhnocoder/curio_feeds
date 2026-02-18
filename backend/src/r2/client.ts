import {
  S3Client,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { config } from "../config.js";

const s3 = new S3Client({
  region: "auto",
  endpoint: config.r2.endpoint,
  credentials: {
    accessKeyId: config.r2.accessKeyId,
    secretAccessKey: config.r2.secretAccessKey,
  },
});

export async function putObject(
  key: string,
  body: Buffer | Uint8Array | string,
  contentType?: string
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: config.r2.bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
    })
  );
}

export async function deleteObjects(keys: string[]): Promise<void> {
  if (keys.length === 0) return;

  // S3 DeleteObjects supports max 1000 keys per call
  const chunks: string[][] = [];
  for (let i = 0; i < keys.length; i += 1000) {
    chunks.push(keys.slice(i, i + 1000));
  }

  for (const chunk of chunks) {
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: config.r2.bucketName,
        Delete: {
          Objects: chunk.map((Key) => ({ Key })),
        },
      })
    );
  }
}

export const r2 = { putObject, deleteObjects };
