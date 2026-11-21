// @vitest-environment node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SongCacheRow } from "@main/database/songCache";
import type { QualityProvenance } from "@shared/types/quality";

const state = vi.hoisted(() => ({
  directory: "",
  rows: new Map<string, SongCacheRow>(),
  limit: 64 / 1024 ** 3,
  resolveMedia: vi.fn(),
}));
vi.mock("@main/services/streaming/mediaSource", () => ({
  resolveStreamingMediaSource: state.resolveMedia,
}));
vi.mock("electron", () => ({ app: { on: vi.fn() } }));
vi.mock("@main/utils/config", () => ({ getSongCacheDir: () => state.directory }));
vi.mock("@main/utils/logger", () => ({ songCacheLog: { info: vi.fn(), warn: vi.fn() } }));
vi.mock("@main/store", () => ({
  store: { get: (key: string) => (key.endsWith("sizeLimitGb") ? state.limit : true) },
}));
vi.mock("@main/database/songCache", () => ({
  findByKey: (key: string) => state.rows.get(key),
  findByFilename: (filename: string) =>
    [...state.rows.values()].find((row) => row.filename === filename),
  upsert: (row: SongCacheRow) => state.rows.set(row.cacheKey, row),
  deleteByKey: (key: string) => state.rows.delete(key),
  clearAll: () => state.rows.clear(),
  touchLastUsed: vi.fn(),
  listAllFilenames: () => [...state.rows.values()].map((row) => row.filename),
  listLruVictims: (limit: number) => [...state.rows.values()].slice(0, limit),
  totalSize: () => [...state.rows.values()].reduce((sum, row) => sum + row.size, 0),
}));

/** 构造供真实流写入流程使用的固定大小音频响应 */
const audioResponse = (): Response =>
  new Response(Buffer.alloc(32, 1), {
    headers: { "content-type": "audio/wav", "content-length": "32" },
  });

describe("歌曲缓存音质依据随存随取", () => {
  beforeEach(async () => {
    vi.resetModules();
    state.rows.clear();
    state.resolveMedia.mockReset().mockResolvedValue({ url: "https://server/audio" });
    state.directory = await fs.mkdtemp(path.join(os.tmpdir(), "splayer-cache-prov-"));
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fs.rm(state.directory, { recursive: true, force: true });
  });

  it("fetch 携带的 provenance 落库并可经 lookupInfo 读回", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const provenance: QualityProvenance = {
      provider: "plugin",
      pluginId: "p1",
      sourceKey: "wy",
      nativeTier: "jymaster",
      level: "jymaster",
      evidence: "plugin",
    };
    const fetched = await cache.fetchAsync(
      "k1",
      "netease",
      "https://music/k1",
      undefined,
      provenance,
    );
    expect(fetched).not.toBeNull();
    const info = await cache.lookupInfo("k1");
    expect(info?.path).toBe(fetched);
    expect(info?.qualityProvenance).toEqual(provenance);
    // 旧签名 lookup 仍返回纯路径
    expect(await cache.lookup("k1")).toBe(fetched);
  });

  it("IPC 传入的脏 provenance 数据被剔除后落库", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    await cache.fetchAsync("k1", "netease", "https://music/k1", undefined, {
      provider: "evil",
      evidence: "nope",
      junk: true,
    } as unknown as QualityProvenance);
    const info = await cache.lookupInfo("k1");
    expect(info?.qualityProvenance).toBeUndefined();
  });

  it("旧缓存记录无 provenance 时 lookupInfo 按未知来源处理", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    const fetched = await cache.fetchAsync("k1", "netease", "https://music/k1");
    expect(fetched).not.toBeNull();
    // 模拟迁移前的旧行：无 provenance
    state.rows.set("k1", { ...state.rows.get("k1")!, qualityProvenance: undefined });
    const info = await cache.lookupInfo("k1");
    expect(info?.path).toBe(fetched);
    expect(info?.qualityProvenance).toBeUndefined();
  });

  it("失效删除缓存行时 provenance 一并移除", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    await cache.fetchAsync("k1", "netease", "https://music/k1", undefined, {
      provider: "official",
      platform: "netease",
      evidence: "response",
      level: "lossless",
    });
    const path = (await cache.lookupInfo("k1"))?.path;
    expect(path).not.toBeNull();
    await cache.invalidate(path!);
    expect(await cache.lookupInfo("k1")).toBeNull();
    expect(state.rows.has("k1")).toBe(false);
  });

  it("来源失效重下后未再携带 provenance 时旧依据被清空", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => audioResponse()),
    );
    const cache = await import("./songCache");
    await cache.fetchAsync("k1", "netease", "https://music/k1", undefined, {
      provider: "plugin",
      pluginId: "p1",
      evidence: "plugin",
      level: "jymaster",
    });
    const first = (await cache.lookupInfo("k1"))?.path;
    expect(first).not.toBeNull();
    // URL 失效：清缓存重下，本次解析未回传 provenance
    await cache.invalidate(first!);
    const refetched = await cache.fetchAsync("k1", "netease", "https://music/k1-retry");
    expect(refetched).not.toBeNull();
    const info = await cache.lookupInfo("k1");
    expect(info?.path).toBe(refetched);
    expect(info?.qualityProvenance).toBeUndefined();
  });
});
