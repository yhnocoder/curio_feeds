import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock config
vi.mock("../config.js", () => ({
  config: {
    retention: { itemDays: 180 },
  },
}));

// Mock rpc
const mockRpc = vi.hoisted(() => ({
  getExpiredItemIds: vi.fn().mockResolvedValue([]),
  getImageR2Keys: vi.fn().mockResolvedValue([]),
  deleteExpiredRecords: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../db/rpc.js", () => ({
  rpc: mockRpc,
}));

// Mock r2
const { mockDeleteObjects } = vi.hoisted(() => ({
  mockDeleteObjects: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../r2/client.js", () => ({
  r2: { deleteObjects: mockDeleteObjects },
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

import { cleanupExpiredItems } from "./lifecycle.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cleanupExpiredItems", () => {
  it("returns early when no expired items", async () => {
    mockRpc.getExpiredItemIds.mockResolvedValueOnce([]);

    await cleanupExpiredItems();

    expect(mockRpc.getExpiredItemIds).toHaveBeenCalledWith(180);
    expect(mockRpc.getImageR2Keys).not.toHaveBeenCalled();
    expect(mockDeleteObjects).not.toHaveBeenCalled();
  });

  it("deletes R2 objects then DB records for expired items", async () => {
    mockRpc.getExpiredItemIds.mockResolvedValueOnce(["item-1", "item-2"]);
    mockRpc.getImageR2Keys.mockResolvedValueOnce(["images/f/abc/0.jpg", "images/f/abc/1.png"]);

    await cleanupExpiredItems();

    // R2 应在 DB 之前删除
    expect(mockDeleteObjects).toHaveBeenCalledWith([
      "images/f/abc/0.jpg",
      "images/f/abc/1.png",
    ]);
    expect(mockRpc.deleteExpiredRecords).toHaveBeenCalledWith(["item-1", "item-2"]);
  });

  it("continues DB cleanup when R2 delete fails", async () => {
    mockRpc.getExpiredItemIds.mockResolvedValueOnce(["item-1"]);
    mockRpc.getImageR2Keys.mockResolvedValueOnce(["images/f/x/0.jpg"]);
    mockDeleteObjects.mockRejectedValueOnce(new Error("R2 unavailable"));

    await cleanupExpiredItems();

    expect(mockRpc.deleteExpiredRecords).toHaveBeenCalledTimes(1);
  });

  it("skips R2 delete when no image tasks have r2 keys", async () => {
    mockRpc.getExpiredItemIds.mockResolvedValueOnce(["item-1"]);
    mockRpc.getImageR2Keys.mockResolvedValueOnce([]);

    await cleanupExpiredItems();

    expect(mockDeleteObjects).not.toHaveBeenCalled();
    expect(mockRpc.deleteExpiredRecords).toHaveBeenCalledTimes(1);
  });

  it("processes in batches of 100", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `item-${i}`);
    mockRpc.getExpiredItemIds.mockResolvedValueOnce(ids);
    mockRpc.getImageR2Keys.mockResolvedValue([]);

    await cleanupExpiredItems();

    // 两批: 100 + 50
    expect(mockRpc.getImageR2Keys).toHaveBeenCalledTimes(2);
    expect(mockRpc.deleteExpiredRecords).toHaveBeenCalledTimes(2);

    // 第一批 100 个
    expect(mockRpc.deleteExpiredRecords.mock.calls[0][0]).toHaveLength(100);
    // 第二批 50 个
    expect(mockRpc.deleteExpiredRecords.mock.calls[1][0]).toHaveLength(50);
  });
});
