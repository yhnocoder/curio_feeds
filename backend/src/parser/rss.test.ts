import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock randomUUID for deterministic tests
let uuidCounter = 0;
vi.mock("node:crypto", async () => {
  const actual = await vi.importActual<typeof import("node:crypto")>("node:crypto");
  return {
    ...actual,
    randomUUID: () => `00000000-0000-0000-0000-${String(uuidCounter++).padStart(12, "0")}`,
  };
});

import { parseRss } from "./rss.js";

beforeEach(() => {
  uuidCounter = 0;
});

const ATOM_FEED = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Blog</title>
  <link href="https://example.com"/>
  <entry>
    <id>entry-1</id>
    <title>First Post</title>
    <link href="https://example.com/post-1"/>
    <published>2024-01-15T10:00:00Z</published>
    <content type="html">&lt;p&gt;Hello &lt;img src="/img/photo.jpg"&gt;&lt;/p&gt;</content>
  </entry>
  <entry>
    <title>No ID Post</title>
    <link href="https://example.com/post-2"/>
    <published>2024-01-16T10:00:00Z</published>
    <content type="html">&lt;p&gt;World&lt;/p&gt;</content>
  </entry>
</feed>`;

const RSS2_FEED = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <title>Test RSS</title>
    <link>https://example.com</link>
    <item>
      <guid>unique-guid-1</guid>
      <title>RSS Item</title>
      <link>https://example.com/item-1</link>
      <pubDate>Mon, 15 Jan 2024 10:00:00 GMT</pubDate>
      <description>&lt;p&gt;Content here&lt;/p&gt;</description>
    </item>
  </channel>
</rss>`;

describe("parseRss", () => {
  it("parses Atom feed correctly", () => {
    const result = parseRss(ATOM_FEED, "https://example.com/feed.xml");

    expect(result.feedTitle).toBe("Test Blog");
    expect(result.feedLink).toBe("https://example.com");
    expect(result.items).toHaveLength(2);

    const first = result.items[0];
    expect(first.id).toBe("00000000-0000-0000-0000-000000000000");
    expect(first.guid).toBe("entry-1");
    expect(first.title).toBe("First Post");
    expect(first.link).toBe("https://example.com/post-1");
    expect(first.pubDate).toBe("2024-01-15T10:00:00.000Z");
  });

  it("resolves relative URLs in content against feed link", () => {
    const result = parseRss(ATOM_FEED, "https://example.com/feed.xml");
    const first = result.items[0];
    // relative /img/photo.jpg should be resolved to absolute
    expect(first.contentHtml).toContain('src="https://example.com/img/photo.jpg"');
  });

  it("parses RSS 2.0 feed correctly", () => {
    const result = parseRss(RSS2_FEED, "https://example.com/rss.xml");

    expect(result.feedTitle).toBe("Test RSS");
    expect(result.items).toHaveLength(1);

    const item = result.items[0];
    expect(item.guid).toBe("unique-guid-1");
    expect(item.title).toBe("RSS Item");
  });

  it("uses link as guid fallback when no id", () => {
    const result = parseRss(ATOM_FEED, "https://example.com/feed.xml");
    // The second entry has no <id>, so it should use the link
    const second = result.items[1];
    expect(second.guid).toBe("https://example.com/post-2");
  });

  it("generates MD5 guid when no id and no link", () => {
    const feed = `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>T</title>
      <item>
        <title>Orphan</title>
        <pubDate>Mon, 15 Jan 2024 10:00:00 GMT</pubDate>
        <description>no link here</description>
      </item>
    </channel></rss>`;

    const result = parseRss(feed, "https://example.com/rss");
    const item = result.items[0];
    // guid should be an MD5 hash (32 hex chars)
    expect(item.guid).toMatch(/^[a-f0-9]{32}$/);
  });

  it("handles items with no pubDate by using current time", () => {
    const feed = `<?xml version="1.0"?>
    <rss version="2.0"><channel><title>T</title>
      <item>
        <guid>no-date</guid>
        <title>No Date Item</title>
        <description>content</description>
      </item>
    </channel></rss>`;

    const before = new Date();
    const result = parseRss(feed, "https://example.com/rss");
    const after = new Date();

    const pubDate = new Date(result.items[0].pubDate!);
    expect(pubDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(pubDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it("returns null for missing feedLink and feedTitle", () => {
    const feed = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item><guid>x</guid><title>X</title><description>d</description></item>
    </channel></rss>`;

    const result = parseRss(feed, "https://example.com/rss");
    expect(result.feedTitle).toBeNull();
  });

  it("does not resolve URLs when no baseUrl (feedLink) is available", () => {
    const feed = `<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <item>
        <guid>x</guid>
        <title>X</title>
        <description>&lt;img src="/relative.jpg"&gt;</description>
      </item>
    </channel></rss>`;

    const result = parseRss(feed, "https://example.com/rss");
    // No feedLink → relative URL should not be resolved
    expect(result.items[0].contentHtml).toContain('src="/relative.jpg"');
  });

  it("preserves absolute URLs and data URIs in content", () => {
    const feed = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <title>T</title>
      <link href="https://example.com"/>
      <entry>
        <id>abs-test</id>
        <title>Abs</title>
        <content type="html">&lt;img src="https://cdn.example.com/pic.jpg"&gt; &lt;img src="data:image/gif;base64,R0l"&gt;</content>
      </entry>
    </feed>`;

    const result = parseRss(feed, "https://example.com/feed");
    const html = result.items[0].contentHtml!;
    expect(html).toContain('src="https://cdn.example.com/pic.jpg"');
    expect(html).toContain("data:image/gif;base64,R0l");
  });
});
