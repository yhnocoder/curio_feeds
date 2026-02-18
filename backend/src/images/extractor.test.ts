import { describe, it, expect } from "vitest";
import { extractImageUrls } from "./extractor.js";

describe("extractImageUrls", () => {
  it("extracts http and https img src from HTML", () => {
    const html = `
      <div>
        <img src="https://example.com/photo.jpg" alt="Photo">
        <img src="http://cdn.example.com/banner.png">
      </div>`;
    const result = extractImageUrls(html);
    expect(result).toEqual([
      { index: 0, url: "https://example.com/photo.jpg" },
      { index: 1, url: "http://cdn.example.com/banner.png" },
    ]);
  });

  it("skips relative paths", () => {
    const html = '<img src="/images/local.jpg"><img src="relative.png">';
    const result = extractImageUrls(html);
    expect(result).toEqual([]);
  });

  it("skips data: URIs", () => {
    const html = '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7">';
    const result = extractImageUrls(html);
    expect(result).toEqual([]);
  });

  it("returns empty array for empty HTML", () => {
    expect(extractImageUrls("")).toEqual([]);
  });

  it("returns empty array for HTML with no images", () => {
    const html = "<p>No images here</p><a href='https://example.com'>link</a>";
    expect(extractImageUrls(html)).toEqual([]);
  });

  it("assigns correct index to multiple images", () => {
    const html = `
      <img src="https://a.com/1.jpg">
      <p>text</p>
      <img src="https://b.com/2.jpg">
      <img src="https://c.com/3.jpg">`;
    const result = extractImageUrls(html);
    expect(result).toHaveLength(3);
    expect(result[0].index).toBe(0);
    expect(result[1].index).toBe(1);
    expect(result[2].index).toBe(2);
  });

  it("skips img tags without src attribute", () => {
    const html = '<img alt="no src"><img src="https://example.com/valid.jpg">';
    const result = extractImageUrls(html);
    expect(result).toEqual([{ index: 1, url: "https://example.com/valid.jpg" }]);
  });
});
