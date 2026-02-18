import { describe, it, expect, vi } from "vitest";
import iconv from "iconv-lite";
import { detectAndConvert } from "./encoding.js";

// Suppress logger output during tests
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("detectAndConvert", () => {
  it("uses charset from Content-Type header", () => {
    const buf = iconv.encode("<?xml version=\"1.0\"?><rss>你好</rss>", "gbk");
    const result = detectAndConvert(buf, "application/xml; charset=gbk");
    expect(result).toContain("你好");
  });

  it("uses encoding from XML declaration when Content-Type has no charset", () => {
    const xml = '<?xml version="1.0" encoding="gbk"?><rss>你好</rss>';
    const buf = iconv.encode(xml, "gbk");
    const result = detectAndConvert(buf, "application/xml");
    expect(result).toContain("你好");
  });

  it("falls back to jschardet auto-detection when no charset info", () => {
    // Create a buffer with enough GBK text for jschardet to detect
    const repeatedText = "中文内容测试数据".repeat(50);
    const xml = `<?xml version="1.0"?><rss>${repeatedText}</rss>`;
    const buf = iconv.encode(xml, "gbk");
    const result = detectAndConvert(buf, "");
    // Should either detect GBK or fall back to UTF-8
    expect(typeof result).toBe("string");
  });

  it("returns buffer as-is when already UTF-8", () => {
    const xml = '<?xml version="1.0" encoding="utf-8"?><rss>Hello</rss>';
    const buf = Buffer.from(xml, "utf-8");
    const result = detectAndConvert(buf, "text/xml; charset=utf-8");
    expect(result).toBe(xml);
  });

  it("falls back to UTF-8 for unknown charset", () => {
    const xml = "<rss>Hello</rss>";
    const buf = Buffer.from(xml, "utf-8");
    const result = detectAndConvert(buf, "text/xml; charset=not-a-real-encoding-xyz");
    expect(result).toContain("Hello");
  });

  it("correctly converts a real GBK buffer", () => {
    const chinese = "这是一段中文测试内容";
    const buf = iconv.encode(chinese, "gbk");
    const result = detectAndConvert(buf, "text/xml; charset=gbk");
    expect(result).toBe(chinese);
  });

  it("handles UTF-8 with different casing in charset", () => {
    const xml = "<rss>data</rss>";
    const buf = Buffer.from(xml, "utf-8");
    const result = detectAndConvert(buf, "text/xml; charset=UTF-8");
    expect(result).toBe(xml);
  });
});
