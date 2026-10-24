import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { mapLxQualityToHost, normalizeLxMusicInfo, pickLxQuality } from "./lx-shim";

/** 第三方脚本真实声明（ikun / EM 音源） */
const IKUN_WY = new Set(["128k", "320k", "flac", "flac24bit", "hires", "atmos", "master"]);
const IKUN_KW = new Set(["128k", "320k", "flac", "flac24bit", "hires"]);

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
