import { createHash, randomUUID } from "node:crypto";
import { parseFeed } from "@rowanmanning/feed-parser";
import { logger } from "../utils/logger.js";

export interface ParsedItem {
  id: string;
  guid: string;
  link: string | null;
  title: string | null;
  pubDate: string | null;
  contentHtml: string | null;
}

export interface ParsedFeed {
  feedTitle: string | null;
  feedLink: string | null;
  items: ParsedItem[];
}

function resolveGuid(
  id: string | null,
  url: string | null,
  title: string | null,
  published: Date | null
): string {
  if (id) return id;
  if (url) return url;
  // Fallback: MD5 of title + pubDate
  const raw = `${title || ""}${published?.toISOString() || ""}`;
  return createHash("md5").update(raw).digest("hex");
}

function formatDate(
  published: Date | null,
  feedUrl: string,
  itemTitle: string | null
): string {
  if (!published) return new Date().toISOString();

  if (isNaN(published.getTime())) {
    logger.warn("Invalid pubDate from parser, using current time", {
      feedUrl,
      itemTitle: itemTitle || "(no title)",
    });
    return new Date().toISOString();
  }
  return published.toISOString();
}

function resolveUrls(html: string, baseUrl: string | null): string {
  if (!baseUrl) return html;
  return html.replace(
    /(src|href)=["'](?!https?:\/\/|data:|#)([^"']+)["']/gi,
    (match, attr, url) => {
      try {
        const absolute = new URL(url, baseUrl).href;
        return `${attr}="${absolute}"`;
      } catch {
        return match;
      }
    }
  );
}

export function parseRss(
  xmlString: string,
  feedUrl: string
): ParsedFeed {
  const feed = parseFeed(xmlString);
  const feedLink = feed.url || null;

  const items: ParsedItem[] = feed.items.map((item) => {
    const contentHtml = item.content || item.description || null;

    const resolved = contentHtml && feedLink
      ? resolveUrls(contentHtml, feedLink)
      : contentHtml;

    return {
      id: randomUUID(),
      guid: resolveGuid(item.id, item.url, item.title, item.published),
      link: item.url || null,
      title: item.title || null,
      pubDate: formatDate(item.published, feedUrl, item.title),
      contentHtml: resolved,
    };
  });

  return {
    feedTitle: feed.title || null,
    feedLink,
    items,
  };
}
