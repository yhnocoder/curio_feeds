import pLimit from "p-limit";
import { rpc, type FeedRow } from "../db/rpc.js";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { processFeed } from "./fetcher.js";

export async function runScheduledFeeds(): Promise<void> {
  const now = new Date().toISOString();

  const feeds = await rpc.getDueFeeds(now);
  if (feeds.length === 0) {
    logger.debug("No feeds due for fetching");
    return;
  }

  logger.info("Scheduling feed fetches", { count: feeds.length });

  const limit = pLimit(config.schedule.maxConcurrentFeeds);

  await Promise.all(
    feeds.map((feed) =>
      limit(async () => {
        try {
          await processFeed(feed);
        } catch (err) {
          logger.error("Unhandled error processing feed", {
            feedId: feed.id,
            url: feed.url,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    )
  );
}
