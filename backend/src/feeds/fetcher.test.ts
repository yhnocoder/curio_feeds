import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
vi.mock("../config.js", () => ({
  config: {
    schedule: { defaultIntervalMinutes: 30 },
  },
}));

// Mock rpc
const mockRpc = vi.hoisted(() => ({
  markFeedNotModified: vi.fn().mockResolvedValue(undefined),
  markFeedSuccess: vi.fn().mockResolvedValue(undefined),
  markFeedFailure: vi.fn().mockResolvedValue(undefined),
  insertItems: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../db/rpc.js", () => ({
  rpc: mockRpc,
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock backupXml
vi.mock("../backup/xml.js", () => ({
  backupXml: vi.fn().mockResolvedValue(undefined),
}));

// Mock encoding
vi.mock("../parser/encoding.js", () => ({
  detectAndConvert: vi.fn().mockReturnValue("<rss>mock</rss>"),
}));

// Mock parseRss
vi.mock("../parser/rss.js", () => ({
  parseRss: vi.fn().mockReturnValue({
    feedTitle: "Test Feed",
    feedLink: "https://example.com",
    items: [
      {
        id: "item-1",
        guid: "guid-1",
        link: "https://example.com/1",
        title: "Item 1",
        pubDate: "2024-01-15T10:00:00.000Z",
        contentHtml: "<p>Hello</p>",
      },
    ],
  }),
}));

// Mock processImages
vi.mock("../images/processor.js", () => ({
  processImages: vi.fn().mockResolvedValue(undefined),
}));

import { processFeed } from "./fetcher.js";

const baseFeed = {
  id: "feed-1",
  url: "https://example.com/rss.xml",
  last_etag: null,
  last_modified: null,
  consecutive_failures: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("processFeed", () => {
  it("handles 304 Not Modified", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 304 })
    );

    await processFeed({ ...baseFeed, last_etag: '"etag-1"' });

    expect(mockRpc.markFeedNotModified).toHaveBeenCalledWith(
      "feed-1",
      expect.any(String),
      expect.any(String)
    );
  });

  it("processes 200 response: parse, insert items, process images", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<rss>data</rss>", {
        status: 200,
        headers: {
          "Content-Type": "application/xml",
          ETag: '"new-etag"',
        },
      })
    );

    await processFeed(baseFeed);

    // 应更新 feed 元数据
    expect(mockRpc.markFeedSuccess).toHaveBeenCalledWith(
      "feed-1",
      "Test Feed",
      '"new-etag"',
      null,
      expect.any(String),
      expect.any(String)
    );

    // 应批量插入条目
    expect(mockRpc.insertItems).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ id: "item-1", feedId: "feed-1", guid: "guid-1" }),
      ])
    );

    // 应处理图片
    const { processImages } = await import("../images/processor.js");
    expect(processImages).toHaveBeenCalledWith("item-1", "<p>Hello</p>", "feed-1", "guid-1");
  });

  it("handles HTTP error by incrementing failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Server Error", { status: 500, statusText: "Internal Server Error" })
    );

    await processFeed(baseFeed);

    expect(mockRpc.markFeedFailure).toHaveBeenCalledWith(
      "feed-1",
      1,
      expect.any(String)
    );
  });

  it("handles network error by incrementing failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("Network error"));

    await processFeed(baseFeed);

    expect(mockRpc.markFeedFailure).toHaveBeenCalledWith(
      "feed-1",
      1,
      expect.any(String)
    );
  });

  it("handles parse error by incrementing failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<rss>data</rss>", { status: 200 })
    );

    const { parseRss } = await import("../parser/rss.js");
    vi.mocked(parseRss).mockImplementationOnce(() => {
      throw new Error("Parse error");
    });

    await processFeed(baseFeed);

    expect(mockRpc.markFeedFailure).toHaveBeenCalledWith(
      "feed-1",
      1,
      expect.any(String)
    );
  });

  it("sends conditional headers when etag/last_modified present", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(null, { status: 304 })
    );

    await processFeed({
      ...baseFeed,
      last_etag: '"etag-1"',
      last_modified: "Mon, 01 Jan 2024 00:00:00 GMT",
    });

    const calledHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(calledHeaders["If-None-Match"]).toBe('"etag-1"');
    expect(calledHeaders["If-Modified-Since"]).toBe("Mon, 01 Jan 2024 00:00:00 GMT");
  });

  it("skips image processing when no items", async () => {
    const { parseRss } = await import("../parser/rss.js");
    vi.mocked(parseRss).mockReturnValueOnce({
      feedTitle: "Empty",
      feedLink: null,
      items: [],
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("<rss></rss>", { status: 200 })
    );

    await processFeed(baseFeed);

    expect(mockRpc.insertItems).not.toHaveBeenCalled();
    const { processImages } = await import("../images/processor.js");
    expect(processImages).not.toHaveBeenCalled();
  });
});

describe("computeNextFetchAt (via processFeed behavior)", () => {
  it("uses exponential backoff on failures", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("error", { status: 500, statusText: "Error" })
    );

    const feed = { ...baseFeed, consecutive_failures: 5 };
    await processFeed(feed);

    // nextFetchAt 应该在未来（带退避）
    const nextFetchAt = mockRpc.markFeedFailure.mock.calls[0][2];
    const nextDate = new Date(nextFetchAt);
    expect(nextDate.getTime()).toBeGreaterThan(Date.now());
  });
});
