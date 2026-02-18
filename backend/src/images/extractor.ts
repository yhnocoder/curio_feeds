import * as cheerio from "cheerio";

export interface ExtractedImage {
  index: number;
  url: string;
}

export function extractImageUrls(html: string): ExtractedImage[] {
  const $ = cheerio.load(html);
  const images: ExtractedImage[] = [];

  $("img").each((index, el) => {
    const src = $(el).attr("src");
    if (src && (src.startsWith("http://") || src.startsWith("https://"))) {
      images.push({ index, url: src });
    }
  });

  return images;
}
