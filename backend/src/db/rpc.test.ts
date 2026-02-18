import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../config.js", () => ({
  config: {
    proxy: {
      url: "https://proxy.example.com",
      authToken: "test-token-123",
    },
  },
}));

import { rpc } from "./rpc.js";

beforeEach(() => {
  vi.restoreAllMocks();
});

function mockRpcResponse(data: unknown) {
  vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify({ data }), { status: 200 })
  );
}

function expectRpcCall(action: string, params?: Record<string, unknown>) {
  expect(globalThis.fetch).toHaveBeenCalledWith(
    "https://proxy.example.com/rpc",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer test-token-123",
      },
      body: JSON.stringify({ action, params }),
    }
  );
}

describe("rpc client", () => {
  it("sends correct action and params for listFeedUrls", async () => {
    mockRpcResponse(["https://a.com/rss", "https://b.com/rss"]);

    const result = await rpc.listFeedUrls();

    expectRpcCall("listFeedUrls", undefined);
    expect(result).toEqual(["https://a.com/rss", "https://b.com/rss"]);
  });

  it("sends correct action and params for getDueFeeds", async () => {
    const feeds = [{ id: "f1", url: "https://a.com", last_etag: null, last_modified: null, consecutive_failures: 0 }];
    mockRpcResponse(feeds);

    const result = await rpc.getDueFeeds("2024-01-01T00:00:00Z");

    expectRpcCall("getDueFeeds", { now: "2024-01-01T00:00:00Z" });
    expect(result).toEqual(feeds);
  });

  it("sends correct action for markFeedFailure", async () => {
    mockRpcResponse(undefined);

    await rpc.markFeedFailure("f1", 3, "2024-01-01T01:00:00Z");

    expectRpcCall("markFeedFailure", { id: "f1", failures: 3, nextFetchAt: "2024-01-01T01:00:00Z" });
  });

  it("sends correct action for insertItems", async () => {
    mockRpcResponse(undefined);
    const items = [{
      id: "i1", feedId: "f1", guid: "g1", link: null,
      title: "Test", pubDate: null, contentHtml: "<p>Hi</p>", createdAt: "2024-01-01T00:00:00Z",
    }];

    await rpc.insertItems(items);

    expectRpcCall("insertItems", { items });
  });

  it("throws on non-200 response with status and body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response('{"error":"Unauthorized"}', { status: 401 })
    );

    await expect(rpc.listFeedUrls()).rejects.toThrow("RPC listFeedUrls failed (401)");
  });

  it("unwraps data field from response", async () => {
    mockRpcResponse(["key1", "key2"]);

    const result = await rpc.getImageR2Keys(["item-1"]);

    expectRpcCall("getImageR2Keys", { itemIds: ["item-1"] });
    expect(result).toEqual(["key1", "key2"]);
  });
});
