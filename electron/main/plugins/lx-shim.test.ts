import { describe, it } from "node:test";
import assert from "node:assert/strict";

import type { HostApi, MusicUrlRes, PluginAction, PluginQuality } from "@shared/types/plugin";
import { installLxShim, mapLxQualityToHost, normalizeLxMusicInfo, pickLxQuality } from "./lx-shim";

type LxRequestHandlerLike = (req: {
  source: string;
  action: string;
  info: Record<string, unknown>;
}) => unknown | Promise<unknown>;

/**
 * 构造已注册 request handler 的 lx 沙箱，返回 musicUrl 动作的派发入口
 * @param scriptHandler - 模拟 lx 脚本通过 lx.on("request") 注册的处理器
 * @returns 宿主侧 musicUrl 处理器（直接传 MusicUrlReq 形状参数调用）
 */
const setupMusicUrl = async (
  scriptHandler: LxRequestHandlerLike,
): Promise<(req: unknown) => Promise<unknown>> => {
  const handlers = new Map<PluginAction, (req: unknown) => Promise<unknown>>();
  const sandbox: Record<string, unknown> = {};
  installLxShim(
    sandbox,
    {
      log: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
      request: async () => ({ status: 200, headers: {}, body: "" }),
    } as unknown as HostApi,
    handlers,
    () => {},
    () => {},
  );
  const lx = sandbox.lx as { on: (eventName: string, handler: unknown) => Promise<void> };
  await lx.on("request", scriptHandler);
  const dispatch = handlers.get("musicUrl");
  assert.equal(typeof dispatch, "function");
  return dispatch!;
};

/**
 * 构造先上报 inited 再注册 request handler 的 lx 沙箱
 * @param sources - 脚本通过 lx.send("inited", {sources}) 声明的能力
 * @param scriptHandler - 模拟 lx 脚本的 request 处理器
 * @param onSources - 捕获宿主收到的规范化 sources
 * @returns 宿主侧 musicUrl 处理器
 */
const setupWithSources = async (
  sources: Record<
    string,
    {
      name?: string;
      actions?: string[];
      qualitys?: string[];
      gzQualityEvidenceVersion?: unknown;
      gzQualityAliases?: unknown;
    }
  >,
  scriptHandler: LxRequestHandlerLike,
  onSources?: (sources: unknown) => void,
): Promise<(req: unknown) => Promise<unknown>> => {
  const handlers = new Map<PluginAction, (req: unknown) => Promise<unknown>>();
  const sandbox: Record<string, unknown> = {};
  installLxShim(
    sandbox,
    {
      log: { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} },
      request: async () => ({ status: 200, headers: {}, body: "" }),
    } as unknown as HostApi,
    handlers,
    (normalized) => onSources?.(normalized),
    () => {},
  );
  const lx = sandbox.lx as {
    on: (eventName: string, handler: unknown) => Promise<void>;
    send: (eventName: string, data: Record<string, unknown>) => Promise<void>;
  };
  await lx.send("inited", { sources });
  await lx.on("request", scriptHandler);
  const dispatch = handlers.get("musicUrl");
  assert.equal(typeof dispatch, "function");
  return dispatch!;
};

/** 第三方脚本真实声明（ikun / EM 音源） */
const IKUN_WY = new Set(["128k", "320k", "flac", "flac24bit", "hires", "atmos", "master"]);
const IKUN_KW = new Set(["128k", "320k", "flac", "flac24bit", "hires"]);

/** 真实安装 EM 脚本（gzPlayback v1）各源声明的原生档位（kw 无 flac24bit，其余源含该别名档） */
const EM_DECLARED: Record<string, ReadonlySet<string>> = {
  kw: new Set(["128k", "320k", "flac", "master"]),
  kg: new Set(["128k", "320k", "flac", "hires", "atmos", "master", "flac24bit"]),
  tx: new Set(["128k", "320k", "flac", "hires", "atmos", "atmos_plus", "master", "flac24bit"]),
  wy: new Set(["128k", "192k", "320k", "flac", "hires", "jyeffect", "sky", "master", "flac24bit"]),
  mg: new Set(["128k", "320k", "flac", "hires", "flac24bit"]),
};

/** 本轮 29 档实测全集：[源, EM 原始档, 宿主等级]，各源档数 kw4/kg6/tx7/wy8/mg4 */
const EM_29_TIERS: ReadonlyArray<readonly [string, string, PluginQuality]> = [
  ["kw", "128k", "lq"],
  ["kw", "320k", "hq"],
  ["kw", "flac", "lossless"],
  ["kw", "master", "jymaster"],
  ["kg", "128k", "lq"],
  ["kg", "320k", "hq"],
  ["kg", "flac", "lossless"],
  ["kg", "hires", "hi-res"],
  ["kg", "atmos", "sky"],
  ["kg", "master", "jymaster"],
  ["tx", "128k", "lq"],
  ["tx", "320k", "hq"],
  ["tx", "flac", "lossless"],
  ["tx", "hires", "hi-res"],
  ["tx", "atmos", "sky"],
  ["tx", "atmos_plus", "sky"],
  ["tx", "master", "jymaster"],
  ["wy", "128k", "lq"],
  ["wy", "192k", "sq"],
  ["wy", "320k", "hq"],
  ["wy", "flac", "lossless"],
  ["wy", "hires", "hi-res"],
  ["wy", "jyeffect", "jyeffect"],
  ["wy", "sky", "sky"],
  ["wy", "master", "jymaster"],
  ["mg", "128k", "lq"],
  ["mg", "320k", "hq"],
  ["mg", "flac", "lossless"],
  ["mg", "hires", "hi-res"],
];

describe("pickLxQuality 音质翻译", () => {
  it("注册映射识别环绕/母带档", () => {
    assert.equal(mapLxQualityToHost("master"), "jymaster");
    assert.equal(mapLxQualityToHost("MASTER"), "jymaster");
    assert.equal(mapLxQualityToHost("atmos"), "sky");
    assert.equal(mapLxQualityToHost("atmos_plus"), "sky");
    assert.equal(mapLxQualityToHost("hires"), "hi-res");
  });

  it("插件声明 master 时母带档翻译成 master 而非 flac24bit", () => {
    assert.deepEqual(pickLxQuality("jymaster", IKUN_WY), { lx: "master", host: "jymaster" });
  });

  it("插件不支持母带档时按候选链降级", () => {
    const picked = pickLxQuality("jymaster", IKUN_KW);
    assert.equal(picked.lx, "hires");
    assert.equal(picked.host, "hi-res");
  });

  it("沉浸环绕声翻译成 atmos", () => {
    assert.deepEqual(pickLxQuality("sky", IKUN_WY), { lx: "atmos", host: "sky" });
  });

  it("高清环绕声回落到候选链中的 atmos", () => {
    const picked = pickLxQuality("jyeffect", IKUN_WY);
    assert.equal(picked.lx, "atmos");
    assert.equal(picked.host, "sky");
  });

  it("高解析档优先声明中的 flac24bit，缺省时用 hires", () => {
    assert.equal(pickLxQuality("hi-res", IKUN_WY).lx, "flac24bit");
    assert.equal(pickLxQuality("hi-res", new Set(["128k", "320k", "hires"])).lx, "hires");
  });

  it("未声明 qualitys 的脚本沿用静态兜底映射", () => {
    const picked = pickLxQuality("jymaster", undefined);
    assert.equal(picked.lx, "flac24bit");
    assert.equal(picked.host, "hi-res");
    assert.equal(pickLxQuality("lossless", new Set()).lx, "flac");
  });

  it("声明与候选链无交集时取不高于请求的最高声明档", () => {
    const picked = pickLxQuality("lossless", new Set(["128k"]));
    assert.equal(picked.lx, "128k");
    assert.equal(picked.host, "lq");
  });
});

describe("本轮 29 档 raw->host 覆盖（真实 EM 声明）", () => {
  it("实测档位总数为 29，各源档数 kw4/kg6/tx7/wy8/mg4", () => {
    assert.equal(EM_29_TIERS.length, 29);
    const counts: Record<string, number> = {};
    for (const [source] of EM_29_TIERS) counts[source] = (counts[source] ?? 0) + 1;
    assert.deepEqual(counts, { kw: 4, kg: 6, tx: 7, wy: 8, mg: 4 });
  });

  // node:test 的 it 无 each，用 for-of 注册每个实测档位的映射用例
  for (const [source, raw, level] of EM_29_TIERS) {
    it(`${source} 原档 ${raw} 直映宿主 ${level}，且声明全集下能精确选中同档原档`, () => {
      // raw->host 覆盖：新 canonical 全部可映射，不落空
      assert.equal(mapLxQualityToHost(raw), level);
      // 按该档宿主等级请求时，选中声明过的原档且等级与请求一致（不降档、不越档）
      const picked = pickLxQuality(level, EM_DECLARED[source]);
      assert.ok(EM_DECLARED[source].has(picked.lx), `picked ${picked.lx} 应在该源声明内`);
      assert.equal(mapLxQualityToHost(picked.lx), level);
      assert.equal(picked.host, level);
    });
  }

  it("EM 未支持的 nac/dts/excellent 保持无映射，不做猜测", () => {
    for (const raw of ["nac", "dts", "excellent"]) {
      assert.equal(mapLxQualityToHost(raw), null);
      assert.equal(mapLxQualityToHost(raw.toUpperCase()), null);
    }
  });
});

describe("具体平台音质选择", () => {
  const callWithSelection = (
    dispatch: (req: unknown) => Promise<unknown>,
    qualitySelection: string,
    quality = "sky",
    source = "tx",
  ): Promise<MusicUrlRes> =>
    dispatch({
      source,
      quality,
      qualitySelection,
      musicInfo: { songmid: "1", id: "1" },
    }) as Promise<MusicUrlRes>;

  it("inited 声明以小写原文保留在 nativeQualities", async () => {
    let captured: Record<string, { nativeQualities?: string[]; qualities?: string[] }> | undefined;
    await setupWithSources(
      {
        tx: { name: "tx", actions: ["musicUrl"], qualitys: ["320k", "QQ-SPATIAL-ALIAS", "320k"] },
      },
      () => "https://x/song",
      (sources) => {
        captured = sources as Record<string, { nativeQualities?: string[]; qualities?: string[] }>;
      },
    );
    assert.deepEqual(captured?.tx?.nativeQualities, ["320k", "qq-spatial-alias"]);
    assert.deepEqual(captured?.tx?.qualities, ["hq"]);
  });

  it("QQ 平原全景声选择在声明内精确请求 atmos 原档，不虚构响应证据", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      { tx: { actions: ["musicUrl"], qualitys: ["flac", "atmos"] } },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return "https://x/spatial.flac";
      },
    );
    const res = await callWithSelection(dispatch, "qqmusic:qq-spatial", "sky", "tx");
    assert.deepEqual(seenTypes, ["atmos"]);
    assert.equal(res.quality, "sky");
    assert.equal(res.requestedTier, "atmos");
    // 字符串回包只是请求回显：不虚构实际档位与实际来源
    assert.equal(res.nativeTier, undefined);
    assert.equal(res.actualSource, undefined);
    assert.equal(res.sourceEvidence, undefined);
  });

  it("QQ 全景声 2.0 选择精确请求 atmos_plus 原档", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      { tx: { actions: ["musicUrl"], qualitys: ["flac", "atmos_plus"] } },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return { url: "https://x/spatial-plus.flac" };
      },
    );
    const res = await callWithSelection(dispatch, "qqmusic:qq-spatial-2.0", "sky", "tx");
    assert.deepEqual(seenTypes, ["atmos_plus"]);
    assert.equal(res.quality, "sky");
    assert.equal(res.requestedTier, "atmos_plus");
  });

  // 平原全景声与全景声 2.0 是两种独立声明：缺哪档都显式报错，互不替代、不互相降级冒充
  for (const [declared, selection] of [
    [["flac", "atmos"], "qqmusic:qq-spatial-2.0"],
    [["flac", "atmos_plus"], "qqmusic:qq-spatial"],
  ] as const) {
    it(`声明 ${declared.join("/")} 时选择 ${selection} 显式报错，不互相替代`, async () => {
      let scriptCalled = false;
      const dispatch = await setupWithSources(
        { tx: { actions: ["musicUrl"], qualitys: [...declared] } },
        () => {
          scriptCalled = true;
          return "https://x/song";
        },
      );
      await assert.rejects(
        () => callWithSelection(dispatch, selection, "sky", "tx"),
        (err: { code?: string }) => err.code === "QUALITY_SELECTION_UNSUPPORTED",
      );
      assert.equal(scriptCalled, false);
    });
  }

  it("未声明 qualitys 时全景声 2.0 选择同样显式报错", async () => {
    const dispatch = await setupMusicUrl(() => "https://x/song");
    await assert.rejects(
      () => callWithSelection(dispatch, "qqmusic:qq-spatial-2.0", "sky", "tx"),
      (err: { code?: string }) => err.code === "QUALITY_SELECTION_UNSUPPORTED",
    );
  });

  it("全景声 2.0 精确回执：nativeTier 保持 atmos_plus，宿主等级仍为 sky", async () => {
    const dispatch = await setupWithSources(
      {
        tx: {
          actions: ["musicUrl"],
          qualitys: ["128k", "320k", "flac", "hires", "atmos", "atmos_plus", "master"],
          gzQualityEvidenceVersion: 1,
        },
      },
      () => ({ url: "https://x/plus.flac", gzPlayback: { version: 1, quality: "atmos_plus" } }),
    );
    const res = await callWithSelection(dispatch, "qqmusic:qq-spatial-2.0", "sky", "tx");
    assert.equal(res.quality, "sky");
    assert.equal(res.nativeTier, "atmos_plus");
    assert.equal(res.requestedTier, "atmos_plus");
    assert.equal(res.requestedSelection, "qqmusic:qq-spatial-2.0");
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
  });

  it("母带 4.0 声明缺精确档时回退通用 master 原档，回执 master 不证明 4 版", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      {
        tx: {
          actions: ["musicUrl"],
          qualitys: ["flac", "master"],
          gzQualityEvidenceVersion: 1,
        },
      },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return { url: "https://x/master.flac", gzPlayback: { version: 1, quality: "master" } };
      },
    );
    const res = await callWithSelection(dispatch, "qqmusic:qq-master-4.0", "jymaster", "tx");
    // 通用 master 候选可以请求
    assert.deepEqual(seenTypes, ["master"]);
    assert.equal(res.quality, "jymaster");
    // 回执 master 与 4.0 原档不同：仅证明母带品牌档，不证明母带 4.0
    assert.equal(res.nativeTier, "master");
    assert.notEqual(res.nativeTier, "qq-master-4.0");
    assert.equal(res.requestedSelection, "qqmusic:qq-master-4.0");
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
  });

  it("migu 旧 premium 选择按 legacy 别名解析，精确请求 hires 原档", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      { mg: { actions: ["musicUrl"], qualitys: ["flac", "hires"] } },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return "https://x/migu.flac";
      },
    );
    const res = await callWithSelection(dispatch, "migu:migu-premium", "hi-res", "mg");
    assert.deepEqual(seenTypes, ["hires"]);
    assert.equal(res.quality, "hi-res");
    assert.equal(res.requestedTier, "hires");
    assert.equal(res.nativeTier, undefined);
  });

  it("母带选择声明缺档时显式报错，不降级冒充", async () => {
    let scriptCalled = false;
    const dispatch = await setupWithSources(
      { tx: { actions: ["musicUrl"], qualitys: ["flac"] } },
      () => {
        scriptCalled = true;
        return "https://x/master.flac";
      },
    );
    await assert.rejects(
      () => callWithSelection(dispatch, "qqmusic:qq-master-4.0", "jymaster"),
      (err: { code?: string }) => err.code === "QUALITY_SELECTION_UNSUPPORTED",
    );
    assert.equal(scriptCalled, false);
  });

  it("历史品牌别名：旧母带 2.0 选择解析到母带 4.0 候选原档", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      { tx: { actions: ["musicUrl"], qualitys: ["flac", "qq-master-4.0"] } },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return "https://x/master4.flac";
      },
    );
    const res = await callWithSelection(dispatch, "qqmusic:qq-master-2.0", "jymaster");
    assert.deepEqual(seenTypes, ["qq-master-4.0"]);
    assert.equal(res.quality, "jymaster");
    assert.equal(res.requestedTier, "qq-master-4.0");
  });

  // node:test 的 it 无 each，用循环注册已下线选择的拒绝用例：
  // QQ 旧 premium（平原全景声 qq-spatial 已恢复为新菜单项，不在其列），
  // 以及本轮删档的 kw hires/premium/spatial 与 mg master/spatial——存档保留原值但解析显式报错
  for (const qualitySelection of [
    "qqmusic:qq-premium-2.0",
    "kuwo:hires",
    "kuwo:kuwo-premium-2.0",
    "kuwo:kuwo-spatial",
    "migu:migu-master",
    "migu:migu-spatial",
  ]) {
    it(`已下线选择 ${qualitySelection} 即使旧候选声明命中也不合法`, async () => {
      let scriptCalled = false;
      // atmos 曾是旧全景声的合法声明候选，菜单删档后同样拒绝
      const dispatch = await setupWithSources(
        { tx: { actions: ["musicUrl"], qualitys: ["320k", "flac", "atmos"] } },
        () => {
          scriptCalled = true;
          return "https://x/song";
        },
      );
      await assert.rejects(
        () => callWithSelection(dispatch, qualitySelection, "sky", "tx"),
        (err: { code?: string }) => err.code === "QUALITY_SELECTION_UNSUPPORTED",
      );
      assert.equal(scriptCalled, false);
    });
  }

  it("未知非空选择显式报错，不再回退通用档位链", async () => {
    let scriptCalled = false;
    const dispatch = await setupWithSources(
      { tx: { actions: ["musicUrl"], qualitys: ["flac24bit"] } },
      () => {
        scriptCalled = true;
        return "https://x/song.flac";
      },
    );
    await assert.rejects(
      () => callWithSelection(dispatch, "qqmusic:does-not-exist"),
      (err: { code?: string }) => err.code === "QUALITY_SELECTION_UNSUPPORTED",
    );
    assert.equal(scriptCalled, false);
  });

  it("未带具体选择的通用请求维持旧档位链，不受选择校验影响", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      { tx: { actions: ["musicUrl"], qualitys: ["flac24bit"] } },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return "https://x/song.flac";
      },
    );
    const res = (await dispatch({
      source: "tx",
      quality: "hi-res",
      musicInfo: { songmid: "1", id: "1" },
    })) as MusicUrlRes;
    assert.deepEqual(seenTypes, ["flac24bit"]);
    assert.equal(res.quality, "hi-res");
  });
});

describe("gzPlayback v1 回执（em 音源）", () => {
  /** em 音源 v1.1.9 真实声明形态：物理档声明 + 版本化回执协议 + 别名 */
  const EM_SOURCES = {
    em: {
      name: "em",
      actions: ["musicUrl"],
      qualitys: ["128k", "320k", "flac", "flac24bit"],
      gzQualityEvidenceVersion: 1,
      gzQualityAliases: { flac24bit: "hires" },
    },
    kw: { name: "kw", actions: ["musicUrl"], qualitys: ["128k", "320k", "flac", "flac24bit"] },
    // 真实安装 EM 脚本的 wy 声明形态：8 档 + flac24bit 别名档 + 三键别名表
    wy: {
      name: "wy",
      actions: ["musicUrl"],
      qualitys: ["128k", "192k", "320k", "flac", "flac24bit", "hires", "jyeffect", "sky", "master"],
      gzQualityEvidenceVersion: 1,
      gzQualityAliases: { flac24bit: "hires", atmos: "jyeffect", jymaster: "master" },
    },
  };

  const callEm = (
    dispatch: (req: unknown) => Promise<unknown>,
    overrides: Record<string, unknown> = {},
  ): Promise<MusicUrlRes> =>
    dispatch({
      source: "em",
      quality: "hi-res",
      musicInfo: { songmid: "1", id: "1" },
      ...overrides,
    }) as Promise<MusicUrlRes>;

  it("inited 上报 v1 能力与净化后的别名，未声明源不带协议字段", async () => {
    let captured: Record<string, Record<string, unknown>> | undefined;
    await setupWithSources(
      {
        em: {
          ...EM_SOURCES.em,
          gzQualityAliases: { flac24bit: "hires", bad: "x".repeat(64), "Atmos_Key.1": "Atmos" },
        },
      },
      () => "https://x/song",
      (sources) => {
        captured = sources as Record<string, Record<string, unknown>>;
      },
    );
    assert.equal(captured?.em?.gzQualityEvidenceVersion, 1);
    // 非法长度条目被丢弃，安全条目小写规范化后保留
    assert.deepEqual(captured?.em?.gzQualityAliases, {
      flac24bit: "hires",
      "atmos_key.1": "atmos",
    });
    assert.equal(captured?.kw?.gzQualityEvidenceVersion, undefined);
    assert.equal(captured?.kw?.gzQualityAliases, undefined);
  });

  it("非白名单版本不采信回执协议，也不带别名", async () => {
    let captured: Record<string, Record<string, unknown>> | undefined;
    await setupWithSources(
      { em: { ...EM_SOURCES.em, gzQualityEvidenceVersion: 2 } },
      () => "https://x/song",
      (sources) => {
        captured = sources as Record<string, Record<string, unknown>>;
      },
    );
    assert.equal(captured?.em?.gzQualityEvidenceVersion, undefined);
    assert.equal(captured?.em?.gzQualityAliases, undefined);
  });

  it("仅 v1 源收到 info.gzPlayback 信封，通用请求 strictQuality 为 false", async () => {
    const envelopes: Record<string, unknown> = {};
    const dispatch = await setupWithSources(EM_SOURCES, (req) => {
      envelopes[req.source] = (req.info as { gzPlayback?: unknown }).gzPlayback;
      return "https://x/song";
    });
    await dispatch({ source: "em", quality: "lossless", musicInfo: { songmid: "1" } });
    await dispatch({ source: "kw", quality: "lossless", musicInfo: { songmid: "1" } });
    assert.deepEqual(envelopes.em, { version: 1, strictQuality: false });
    assert.equal(envelopes.kw, undefined);
  });

  it("请求 flac24bit 经别名映射为 hires，回执 flac 记为实际档位", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(EM_SOURCES, (req) => {
      seenTypes.push(String((req.info as { type?: string }).type));
      return {
        url: "https://x/em.flac",
        gzPlayback: {
          version: 1,
          quality: "flac",
          urlCache: "https://c/1",
          refreshStatus: 0,
          expiresAt: 1730000000000,
        },
      };
    });
    const res = await callEm(dispatch);
    assert.deepEqual(seenTypes, ["hires"]);
    assert.equal(res.url, "https://x/em.flac");
    assert.equal(res.requestedTier, "hires");
    assert.equal(res.nativeTier, "flac");
    assert.equal(res.quality, "lossless");
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
    assert.equal(res.actualSource, undefined);
  });

  it("显式选择请求 strictQuality 为 true 且回执带 requestedSelection", async () => {
    const envelopes: unknown[] = [];
    const dispatch = await setupWithSources(EM_SOURCES, (req) => {
      envelopes.push((req.info as { gzPlayback?: unknown }).gzPlayback);
      return { url: "https://x/em.flac", gzPlayback: { version: 1, quality: "flac" } };
    });
    const res = await callEm(dispatch, { qualitySelection: "netease:hires" });
    assert.deepEqual(envelopes, [{ version: 1, strictQuality: true }]);
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
    assert.equal(res.requestedSelection, "netease:hires");
    assert.equal(res.nativeTier, "flac");
    assert.equal(res.requestedTier, "hires");
  });

  it("回执版本非法时不采信：保持请求回显，不带 sourceEvidence", async () => {
    const dispatch = await setupWithSources(EM_SOURCES, () => ({
      url: "https://x/em.flac",
      gzPlayback: { version: 2, quality: "flac" },
    }));
    const res = await callEm(dispatch);
    assert.equal(res.sourceEvidence, undefined);
    assert.equal(res.nativeTier, undefined);
    assert.equal(res.quality, "hi-res");
  });

  it("回执档位无法识别时不回写请求档位，仅保留源回传文本", async () => {
    const dispatch = await setupWithSources(EM_SOURCES, () => ({
      url: "https://x/em.flac",
      gzPlayback: { version: 1, quality: "relay-super" },
    }));
    const res = await callEm(dispatch);
    assert.equal(res.nativeTier, "relay-super");
    assert.equal(res.quality, undefined);
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
    assert.equal(res.requestedTier, "hires");
  });

  it("严格选择声明对不上时直接报错，不降级也不发请求", async () => {
    let scriptCalled = false;
    const dispatch = await setupWithSources(EM_SOURCES, () => {
      scriptCalled = true;
      return "https://x/song";
    });
    await assert.rejects(
      () =>
        callEm(dispatch, {
          source: "kw",
          quality: "sky",
          qualitySelection: "qqmusic:qq-spatial-2.0",
        }),
      (err: { code?: string }) => err.code === "QUALITY_SELECTION_UNSUPPORTED",
    );
    assert.equal(scriptCalled, false);
  });

  it("v1 源字符串回包仍是请求回显，不产生回执证据", async () => {
    const dispatch = await setupWithSources(EM_SOURCES, () => "https://x/song");
    const res = await callEm(dispatch, { quality: "lossless" });
    assert.equal(res.quality, "lossless");
    assert.equal(res.sourceEvidence, undefined);
    assert.equal(res.nativeTier, undefined);
    assert.equal(res.requestedTier, "flac");
  });

  it("回执路径上显式 actualSource 仍保留", async () => {
    const dispatch = await setupWithSources(EM_SOURCES, () => ({
      url: "https://x/em.flac",
      actualSource: "kw",
      gzPlayback: { version: 1, quality: "flac" },
    }));
    const res = await callEm(dispatch, { quality: "lossless" });
    assert.equal(res.actualSource, "kw");
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
    assert.equal(res.nativeTier, "flac");
    assert.equal(res.quality, "lossless");
  });

  it("wy 真实三键别名表净化后原样保留，声明档位完整登记", async () => {
    let captured: Record<string, Record<string, unknown>> | undefined;
    await setupWithSources(
      EM_SOURCES,
      () => "https://x/song",
      (sources) => {
        captured = sources as Record<string, Record<string, unknown>>;
      },
    );
    assert.equal(captured?.wy?.gzQualityEvidenceVersion, 1);
    assert.deepEqual(captured?.wy?.gzQualityAliases, {
      flac24bit: "hires",
      atmos: "jyeffect",
      jymaster: "master",
    });
    assert.deepEqual(captured?.wy?.nativeQualities, [
      "128k",
      "192k",
      "320k",
      "flac",
      "flac24bit",
      "hires",
      "jyeffect",
      "sky",
      "master",
    ]);
  });

  it("wy hi-res 请求经 flac24bit→hires 别名发出 hires，回执如实回写", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(EM_SOURCES, (req) => {
      seenTypes.push(String((req.info as { type?: string }).type));
      return { url: "https://x/wy.flac", gzPlayback: { version: 1, quality: "hires" } };
    });
    const res = (await dispatch({
      source: "wy",
      quality: "hi-res",
      musicInfo: { songmid: "1", id: "1" },
    })) as MusicUrlRes;
    assert.deepEqual(seenTypes, ["hires"]);
    assert.equal(res.nativeTier, "hires");
    assert.equal(res.quality, "hi-res");
    assert.equal(res.requestedTier, "hires");
    assert.equal(res.sourceEvidence, "gzPlayback-v1");
  });

  it("别名表安全档转换：候选命中 atmos/jymaster 时换发脚本实际接受的 jyeffect/master", async () => {
    const seenTypes: string[] = [];
    const dispatch = await setupWithSources(
      {
        wy: {
          name: "wy",
          actions: ["musicUrl"],
          qualitys: ["flac", "atmos", "jymaster"],
          gzQualityEvidenceVersion: 1,
          gzQualityAliases: { atmos: "jyeffect", jymaster: "master" },
        },
      },
      (req) => {
        seenTypes.push(String((req.info as { type?: string }).type));
        return "https://x/wy.flac";
      },
    );
    await dispatch({ source: "wy", quality: "jyeffect", musicInfo: { songmid: "1", id: "1" } });
    await dispatch({ source: "wy", quality: "jymaster", musicInfo: { songmid: "1", id: "1" } });
    assert.deepEqual(seenTypes, ["jyeffect", "master"]);
  });
});

describe("normalizeLxMusicInfo", () => {
  it("处理网易云等无 hash 歌曲时，不应设置空串 hash，且 ?? 能正确兜底到 songmid", () => {
    const raw = {
      songmid: "208902",
      name: "红色高跟鞋",
      singer: "蔡健雅",
      albumId: "20744",
      albumName: "若你碰到他",
    };

    const info = normalizeLxMusicInfo(raw, "wy");

    assert.equal(info.songmid, "208902");
    assert.equal(info.id, "208902");
    assert.equal(info.hash, undefined);
    assert.equal("hash" in info, false);
    assert.equal(info.meta.hash, undefined);
    assert.equal("hash" in info.meta, false);

    // 验证第三方插件常见写法：const songId = musicInfo.hash ?? musicInfo.songmid
    const resolvedSongId = info.hash ?? info.songmid;
    assert.equal(resolvedSongId, "208902");
  });

  it("当输入中包含空串 hash 时，应清理掉而不能透传空串", () => {
    const raw = {
      songmid: "208902",
      name: "红色高跟鞋",
      singer: "蔡健雅",
      hash: "",
      meta: {
        songId: "208902",
        albumName: "",
        albumId: "",
        picUrl: null,
        hash: "",
      },
    };

    const info = normalizeLxMusicInfo(raw, "wy");

    assert.equal(info.hash, undefined);
    assert.equal("hash" in info, false);
    assert.equal(info.meta.hash, undefined);
    assert.equal("hash" in info.meta, false);

    const resolvedSongId = info.hash ?? info.songmid;
    assert.equal(resolvedSongId, "208902");
  });

  it("处理酷狗歌曲且有有效 32 位 hash 时，应保留并正确提取 hash", () => {
    const hex32 = "e10adc3949ba59abbe56e057f20f883e";
    const raw = {
      songmid: hex32,
      name: "测试歌曲",
      singer: "测试歌手",
    };

    const info = normalizeLxMusicInfo(raw, "kg");

    assert.equal(info.hash, hex32);
    assert.equal(info.meta.hash, hex32);

    const resolvedSongId = info.hash ?? info.songmid;
    assert.equal(resolvedSongId, hex32);
  });

  it("处理酷狗歌曲显式传入 hash 时，应优先使用显式传入的 hash", () => {
    const customHash = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const raw = {
      songmid: "123456",
      name: "测试歌曲",
      singer: "测试歌手",
      hash: customHash,
    };

    const info = normalizeLxMusicInfo(raw, "kg");

    assert.equal(info.hash, customHash);
    assert.equal(info.meta.hash, customHash);
    assert.equal(info.songmid, "123456");
  });

  it("非咪咕源无 copyrightId 时不应挂载空串 copyrightId", () => {
    const raw = {
      songmid: "208902",
      name: "红色高跟鞋",
      copyrightId: "",
    };

    const info = normalizeLxMusicInfo(raw, "wy");
    assert.equal(info.copyrightId, undefined);
    assert.equal("copyrightId" in info, false);
  });
});

describe("musicUrl 回包归一与来源证据", () => {
  const callMusicUrl = (
    dispatch: (req: unknown) => Promise<unknown>,
    source = "wy",
    quality = "lossless",
  ): Promise<MusicUrlRes> =>
    dispatch({ source, quality, musicInfo: { songmid: "1", id: "1" } }) as Promise<MusicUrlRes>;

  it("字符串回包是请求回显：带 requestedTier，不虚构 actualSource/nativeTier", async () => {
    const dispatch = await setupMusicUrl(() => "https://x/song.flac");
    const res = await callMusicUrl(dispatch);
    assert.equal(res.url, "https://x/song.flac");
    assert.equal(res.quality, "lossless");
    assert.equal(res.requestedTier, "flac");
    assert.equal(res.actualSource, undefined);
    assert.equal(res.nativeTier, undefined);
  });

  it("对象回包显式回传的 actualSource / nativeTier 原样保留", async () => {
    const dispatch = await setupMusicUrl(() => ({
      url: "https://x/a.flac",
      actualSource: "kg",
      nativeTier: "2000k",
    }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.url, "https://x/a.flac");
    assert.equal(res.actualSource, "kg");
    assert.equal(res.nativeTier, "2000k");
    assert.equal(res.requestedTier, "flac");
    assert.equal(res.quality, "lossless");
  });

  it("对象回包 source 等于请求来源时不当作实际来源", async () => {
    const dispatch = await setupMusicUrl(() => ({ url: "https://x/b.flac", source: "wy" }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.actualSource, undefined);
  });

  it("对象回包 source 不同于请求来源时保留为实际来源", async () => {
    const dispatch = await setupMusicUrl(() => ({ url: "https://x/c.flac", source: "kw" }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.actualSource, "kw");
  });

  it("platform 字段同样作为显式实际来源", async () => {
    const dispatch = await setupMusicUrl(() => ({ url: "https://x/d.flac", platform: "kugou" }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.actualSource, "kugou");
  });

  it("数字串 quality 记为响应原生档位，宿主档位保持请求换算值", async () => {
    const dispatch = await setupMusicUrl(() => ({ url: "https://x/e.flac", quality: "999" }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.nativeTier, "999");
    assert.equal(res.quality, "lossless");
    assert.equal(res.requestedTier, "flac");
  });

  it("可映射的 quality 字符串按响应声明覆盖宿主档位", async () => {
    const dispatch = await setupMusicUrl(() => ({ url: "https://x/f.mp3", quality: "320k" }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.quality, "hq");
    assert.equal(res.nativeTier, undefined);
  });

  it("非法来源键与超长档位文本被丢弃", async () => {
    const dispatch = await setupMusicUrl(() => ({
      url: "https://x/g.flac",
      actualSource: "not a source!",
      nativeTier: "x".repeat(128),
    }));
    const res = await callMusicUrl(dispatch);
    assert.equal(res.actualSource, undefined);
    assert.equal(res.nativeTier, undefined);
  });

  it("无效回包仍拒绝并标记 PLUGIN_INVALID_RESULT", async () => {
    const dispatch = await setupMusicUrl(() => ({ foo: "bar" }));
    await assert.rejects(
      () => callMusicUrl(dispatch),
      (err: { code?: string }) => err.code === "PLUGIN_INVALID_RESULT",
    );
  });
});

describe("sandbox console and window compatibility", () => {
  it("沙箱控制台应支持 group/groupEnd/table/time/assert 等方法且 window.console 正常工作", () => {
    const logs: string[] = [];
    const fakeSplayer = {
      log: {
        info: (...args: unknown[]) => logs.push(`info:${args.join(" ")}`),
        debug: (...args: unknown[]) => logs.push(`debug:${args.join(" ")}`),
        warn: (...args: unknown[]) => logs.push(`warn:${args.join(" ")}`),
        error: (...args: unknown[]) => logs.push(`error:${args.join(" ")}`),
      },
    };

    const sandboxConsole = {
      log: fakeSplayer.log.info,
      info: fakeSplayer.log.info,
      debug: fakeSplayer.log.debug,
      warn: fakeSplayer.log.warn,
      error: fakeSplayer.log.error,
      group: fakeSplayer.log.info,
      groupCollapsed: fakeSplayer.log.info,
      groupEnd: (): void => {},
      table: fakeSplayer.log.info,
      dir: fakeSplayer.log.info,
      dirxml: fakeSplayer.log.info,
      trace: fakeSplayer.log.debug,
      clear: (): void => {},
      time: (_label?: string): void => {},
      timeEnd: (_label?: string): void => {},
      timeLog: (_label?: string, ..._data: unknown[]): void => {},
      count: (_label?: string): void => {},
      countReset: (_label?: string): void => {},
      assert: (condition?: boolean, ...args: unknown[]): void => {
        if (!condition) fakeSplayer.log.error(...args);
      },
    };

    const sandboxGlobal: Record<string, unknown> = {
      console: sandboxConsole,
    };
    sandboxGlobal.globalThis = sandboxGlobal;
    sandboxGlobal.window = sandboxGlobal;
    sandboxGlobal.self = sandboxGlobal;

    // 验证常见 LX 插件方法调用均不抛错
    assert.doesNotThrow(() => {
      sandboxConsole.group("test group");
      sandboxConsole.groupCollapsed("collapsed");
      sandboxConsole.groupEnd();
      sandboxConsole.table([{ a: 1 }]);
      sandboxConsole.time("timer");
      sandboxConsole.timeEnd("timer");
      sandboxConsole.assert(true, "should not log");
      sandboxConsole.assert(false, "assertion failed");
    });

    // 验证 window.console 能够访问并且方法正常
    const windowObj = sandboxGlobal.window as Record<string, unknown>;
    const windowConsole = windowObj.console as typeof sandboxConsole;
    assert.equal(typeof windowConsole.groupEnd, "function");
    assert.doesNotThrow(() => {
      windowConsole.groupEnd();
    });

    assert.ok(logs.includes("info:test group"));
    assert.ok(logs.includes("error:assertion failed"));
  });
});
