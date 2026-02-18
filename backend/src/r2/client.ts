import {
  S3Client,
  PutObjectCommand,
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

export const r2 = { putObject };
