import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  proxy: {
    url: required("PROXY_WORKER_URL"),
    authToken: required("PROXY_AUTH_TOKEN"),
  },
  r2: {
    endpoint: required("R2_ENDPOINT"),
    accessKeyId: required("R2_ACCESS_KEY_ID"),
    secretAccessKey: required("R2_SECRET_ACCESS_KEY"),
    bucketName: required("R2_BUCKET_NAME"),
  },
  api: {
    port: parseInt(process.env.API_PORT || "3000", 10),
  },
  retention: {
    itemDays: parseInt(process.env.ITEM_RETENTION_DAYS || "180", 10),
  },
  schedule: {
    defaultIntervalMinutes: parseInt(
      process.env.DEFAULT_FETCH_INTERVAL_MINUTES || "30",
      10
    ),
    maxConcurrentFeeds: parseInt(process.env.MAX_CONCURRENT_FEEDS || "5", 10),
  },
} as const;
