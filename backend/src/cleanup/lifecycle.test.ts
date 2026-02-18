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
  deleteExpiredRecords: vi.fn().mockResolvedValue(undefined),
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

import { cleanupExpiredItems } from "./lifecycle.js";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("cleanupExpiredItems", () => {
  it("returns early when no expired items", async () => {
    mockRpc.getExpiredItemIds.mockResolvedValueOnce([]);

    await cleanupExpiredItems();

    expect(mockRpc.getExpiredItemIds).toHaveBeenCalledWith(180);
    expect(mockRpc.deleteExpiredRecords).not.toHaveBeenCalled();
  });

  it("deletes expired items from DB", async () => {
    mockRpc.getExpiredItemIds.mockResolvedValueOnce(["item-1", "item-2"]);

    await cleanupExpiredItems();

    expect(mockRpc.deleteExpiredRecords).toHaveBeenCalledWith(["item-1", "item-2"]);
  });

  it("processes in batches of 100", async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `item-${i}`);
    mockRpc.getExpiredItemIds.mockResolvedValueOnce(ids);

    await cleanupExpiredItems();

    expect(mockRpc.deleteExpiredRecords).toHaveBeenCalledTimes(2);
    expect(mockRpc.deleteExpiredRecords.mock.calls[0][0]).toHaveLength(100);
    expect(mockRpc.deleteExpiredRecords.mock.calls[1][0]).toHaveLength(50);
  });
});
