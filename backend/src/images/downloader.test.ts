import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// Mock r2 client
const { mockPutObject } = vi.hoisted(() => ({
  mockPutObject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../r2/client.js", () => ({
  r2: { putObject: mockPutObject },
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

import { downloadAndUpload } from "./downloader.js";

beforeEach(() => {
  vi.restoreAllMocks();
  mockPutObject.mockResolvedValue(undefined);
});

describe("downloadAndUpload", () => {
  it("downloads image and uploads to R2 with correct key", async () => {
    const imageData = Buffer.from("fake-image-data");
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(imageData, {
        status: 200,
        headers: { "Content-Type": "image/jpeg" },
      })
    );

    const r2Key = await downloadAndUpload(
      "https://example.com/photo.jpg",
      "feed-1",
      "guid-abc",
      0
    );

    const guidHash = createHash("md5").update("guid-abc").digest("hex").slice(0, 8);
    expect(r2Key).toBe(`images/feed-1/${guidHash}/0.jpg`);
    expect(mockPutObject).toHaveBeenCalledWith(
      r2Key,
      expect.any(Buffer),
      "image/jpeg"
    );
  });

  it("throws on non-OK HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 })
    );

    await expect(
      downloadAndUpload("https://example.com/missing.jpg", "feed-1", "guid-1", 0)
    ).rejects.toThrow("HTTP 404");
  });

  it("infers extension from Content-Type header", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(Buffer.from("data"), {
        status: 200,
        headers: { "Content-Type": "image/png" },
      })
    );

    const key = await downloadAndUpload("https://example.com/noext", "f", "g", 0);
    expect(key).toMatch(/\.png$/);
  });

  it("infers extension from URL when Content-Type missing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(Buffer.from("data"), { status: 200 })
    );

    const key = await downloadAndUpload("https://example.com/pic.webp", "f", "g", 0);
    expect(key).toMatch(/\.webp$/);
  });

  it("uses 'bin' extension when no type info available", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(Buffer.from("data"), { status: 200 })
    );

    const key = await downloadAndUpload("https://example.com/unknown", "f", "g", 0);
    expect(key).toMatch(/\.bin$/);
  });

  it("maps various content types to correct extensions", async () => {
    const cases: [string, string][] = [
      ["image/gif", "gif"],
      ["image/webp", "webp"],
      ["image/svg+xml", "svg"],
      ["image/avif", "avif"],
      ["image/jpeg; charset=utf-8", "jpg"],
    ];

    for (const [contentType, expectedExt] of cases) {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(Buffer.from("d"), {
          status: 200,
          headers: { "Content-Type": contentType },
        })
      );
      const key = await downloadAndUpload("https://example.com/x", "f", "g", 0);
      expect(key).toMatch(new RegExp(`\\.${expectedExt}$`));
    }
  });

  it("infers extension from URL with query params", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(Buffer.from("data"), { status: 200 })
    );

    const key = await downloadAndUpload(
      "https://example.com/image.png?w=100&h=100",
      "f",
      "g",
      0
    );
    expect(key).toMatch(/\.png$/);
  });
});
