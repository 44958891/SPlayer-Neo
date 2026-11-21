// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  fetchMock: vi.fn<(url: string | URL, init?: RequestInit) => Promise<Response>>(),
  logDebug: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@main/database/sessions", () => ({
  getSessionCookies: () => state.cookies,
  saveSessionCookies: (_platform: string, cookies: Record<string, string>) => {
    state.cookies = { ...cookies };
  },
  clearSessionCookies: () => {
    state.cookies = {};
  },
}));
vi.mock("@main/utils/logger", () => ({
  coreLog: {
    debug: state.logDebug,
    info: state.logInfo,
    warn: state.logWarn,
    error: state.logError,
  },
}));

const SESSION_MODULE = "music.getSession.session";
const LOGIN_MODULE = "music.login.LoginServer";
const SEARCH_MODULE = "music.search.SearchCgiService";

interface FcgRoutes {
  session?: () => Response | Promise<Response>;
  login?: () => Response | Promise<Response>;
  business?: () => Response | Promise<Response>;
}

/** 构造 fcg JSON 响应 */
const fcgJson = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** 业务成功响应体 */
const okBody = (data: unknown = {}) => ({ code: 0, request: { code: 0, data } });

/** 业务错误响应体 */
const bizBody = (innerCode: number, outerCode = 0) => ({
  code: outerCode,
  request: { code: innerCode },
});

/** 刷新成功响应体（轮换后的 key） */
const loginOk = (newKey: string): Response =>
  fcgJson(okBody({ musickey: newKey, str_musicid: "123456", loginType: 2, refresh_key: "rk-new" }));

/** 按 fcg 请求体 module 分发响应；routes 对象可随后原地修改切换场景 */
const mockFcg = (routes: FcgRoutes): void => {
  state.fetchMock.mockImplementation(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { request?: { module?: string } };
    const mod = body.request?.module ?? "";
    if (mod === SESSION_MODULE && routes.session) return routes.session();
    if (mod === LOGIN_MODULE && routes.login) return routes.login();
    if (routes.business) return routes.business();
    throw new TypeError(`qm spec: unrouted module ${mod}`);
  });
};

/** 从 fetch 调用参数中解析 fcg module */
const moduleOf = (call: unknown[]): string => {
  const init = call[1] as RequestInit | undefined;
  const body = JSON.parse(String(init?.body)) as { request?: { module?: string } };
  return body.request?.module ?? "";
};

/** 统计某 module 的 fetch 调用次数 */
const callsByModule = (mod: string): unknown[] =>
  state.fetchMock.mock.calls.filter((call) => moduleOf(call as unknown[]) === mod);

/** 写入已登录 cookie（QQ 型，uin=123456） */
const setLoggedIn = (uin = "123456", key = "key-A"): void => {
  state.cookies = {
    uin,
    qm_str_musicid: uin,
    qm_keyst: key,
    qqmusic_key: key,
    tmeLoginType: "2",
    psrf_qqopenid: "openid-A",
    psrf_qqrefresh_token: "rtoken-A",
    psrf_qqaccess_token: "atok-A",
  };
};

/** 模拟外部手动换号登录的 cookie 集 */
const manualCookies = (uin: string, key: string): Record<string, string> => ({
  uin,
  qm_str_musicid: uin,
  qm_keyst: key,
  qqmusic_key: key,
  tmeLoginType: "2",
  psrf_qqopenid: `openid-${uin}`,
  psrf_qqrefresh_token: `rtoken-${uin}`,
});

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const loadRequest = (): Promise<typeof import("./request")> => import("./request");

/**
 * 等待请求拒绝，断言抛出 QMRequestError 并返回强类型错误实例
 * @param mod - 当前测试导入的 request 模块（类实例随 resetModules 更换）
 * @param promise - 预期拒绝的请求 Promise
 * @returns 断言后的 QMRequestError
 */
const catchError = async (
  mod: typeof import("./request"),
  promise: Promise<unknown>,
): Promise<InstanceType<(typeof mod)["QMRequestError"]>> => {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(mod.QMRequestError);
  return caught as InstanceType<(typeof mod)["QMRequestError"]>;
};

describe("QM 请求层", () => {
  beforeEach(() => {
    vi.resetModules();
    state.cookies = {};
    state.fetchMock.mockReset();
    vi.stubGlobal("fetch", state.fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("2001 鉴权错误刷新一次并重放，仍 2001 立即抛业务错误", async () => {
    setLoggedIn();
    mockFcg({
      session: () => fcgJson(okBody({ session: { uid: "u1", sid: "s1", userip: "1.2.3.4" } })),
      login: () => loginOk("key-B"),
      business: () => fcgJson(bizBody(2001)),
    });
    const mod = await loadRequest();

    const err = await catchError(mod, mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}));
    expect(err.kind).toBe("business");
    expect(err.outerCode).toBe(0);
    expect(err.innerCode).toBe(2001);
    expect(err.message).toBe("QM API 错误: outer=0 inner=2001");
    // 刷新仅一次 + 重放仅一次（session 初始一次、重放前重取一次）
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    expect(callsByModule(SESSION_MODULE)).toHaveLength(2);
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(2);
    expect(mod.getQQMusicCookies().qm_keyst).toBe("key-B");
    // 刷新写回保留未轮换的原始字段
    expect(mod.getQQMusicCookies().psrf_qqopenid).toBe("openid-A");
    expect(mod.getQQMusicCookies().psrf_qqaccess_token).toBe("atok-A");

    // 紧接着的第二次 2001：冷却期内不再刷新，仅用新凭据重放一次后仍失败
    const err2 = await catchError(
      mod,
      mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}),
    );
    expect(err2.innerCode).toBe(2001);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(4);
  });

  it("并发 2001 触发的刷新只发一次（singleflight）", async () => {
    setLoggedIn();
    mockFcg({
      session: () => fcgJson(okBody({ session: { uid: "u1", sid: "s1" } })),
      login: async () => {
        await delay(20);
        return loginOk("key-B");
      },
      business: () => fcgJson(bizBody(2001)),
    });
    const mod = await loadRequest();

    const results = await Promise.allSettled([
      mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}),
      mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    // 双方各重放一次
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(4);
  });

  it("刷新成功重放后恢复，冷却期内 refreshQMCredential 返回 false", async () => {
    setLoggedIn();
    let bizCalls = 0;
    const routes: FcgRoutes = {
      session: () => fcgJson(okBody({ session: { uid: "u1", sid: "s1" } })),
      login: () => loginOk("key-B"),
      business: () => {
        bizCalls++;
        return bizCalls === 1 ? fcgJson(bizBody(2001)) : fcgJson(okBody({ songs: [] }));
      },
    };
    mockFcg(routes);
    const mod = await loadRequest();

    const data = await mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {});
    expect(data).toEqual({ songs: [] });
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);

    // 冷却期内直接调用刷新 → false 且不再发 Login
    expect(await mod.refreshQMCredential()).toBe(false);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);

    // 后续 2001 在冷却期内也只重放不刷新，仍失败即抛
    routes.business = () => fcgJson(bizBody(2001));
    const err = await catchError(mod, mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}));
    expect(err.innerCode).toBe(2001);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(4);
  });

  it("刷新被拒绝后冷却期内不再刷新，日志只含业务码不含凭据", async () => {
    setLoggedIn();
    mockFcg({
      session: () => fcgJson(okBody({ session: { uid: "u1", sid: "s1" } })),
      login: () => fcgJson(bizBody(3001)),
      business: () => fcgJson(bizBody(2001)),
    });
    const mod = await loadRequest();

    const err = await catchError(mod, mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}));
    expect(err.innerCode).toBe(2001);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);

    // 刷新失败无近期成功 → 第二次 2001 不重放直接抛
    const err2 = await catchError(
      mod,
      mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}),
    );
    expect(err2.innerCode).toBe(2001);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(2);

    // 日志消毒：凭据明文不落日志，拒绝原因只打业务码
    const allLogs = JSON.stringify([
      state.logInfo.mock.calls,
      state.logWarn.mock.calls,
      state.logDebug.mock.calls,
      state.logError.mock.calls,
    ]);
    expect(allLogs).not.toContain("key-A");
    expect(allLogs).not.toContain("rtoken-A");
    expect(allLogs).toContain("inner=3001");
  });

  it("业务码 1000 同样触发刷新并以新凭据重放成功", async () => {
    setLoggedIn();
    let bizCalls = 0;
    mockFcg({
      session: () => fcgJson(okBody({ session: { uid: "u1", sid: "s1" } })),
      login: () => loginOk("key-B"),
      business: () => {
        bizCalls++;
        return bizCalls === 1 ? fcgJson(bizBody(1000)) : fcgJson(okBody({ ok: true }));
      },
    });
    const mod = await loadRequest();

    const data = await mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {});
    expect(data).toEqual({ ok: true });
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(2);
  });

  it("手动换号登录与清空账号都会重置刷新冷却", async () => {
    setLoggedIn();
    const routes: FcgRoutes = {
      session: () => fcgJson(okBody({ session: { uid: "u1", sid: "s1" } })),
      login: () => loginOk("key-B"),
      business: () => fcgJson(bizBody(2001)),
    };
    mockFcg(routes);
    const mod = await loadRequest();

    // 第一轮：刷新一次进入冷却
    await mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}).catch(() => {});
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);
    await mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}).catch(() => {});
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);

    // 手动换号登录 → 冷却重置 → 再次 2001 发起第二次刷新
    mod.mergeQQMusicCookies(manualCookies("888888", "key-C"));
    routes.login = () =>
      fcgJson(
        okBody({ musickey: "key-D", str_musicid: "888888", loginType: 2, refresh_key: "rk" }),
      );
    await mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}).catch(() => {});
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(2);

    // 清空账号 + 重新写入凭据 → 冷却再次重置 → 直接调用刷新立即执行
    mod.clearQQMusicCookies();
    mod.mergeQQMusicCookies(manualCookies("777777", "key-E"));
    expect(await mod.refreshQMCredential()).toBe(true);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(3);
  });

  it("刷新请求期间账号被切换时丢弃旧账号的刷新结果", async () => {
    setLoggedIn();
    const routes: FcgRoutes = {
      login: async () => {
        // 模拟刷新请求在途时用户手动换号登录
        await delay(10);
        manualMerge();
        return loginOk("key-B");
      },
      business: () => fcgJson(bizBody(2001)),
    };
    const manualMerge = vi.fn(() => mod.mergeQQMusicCookies(manualCookies("999999", "key-X")));
    mockFcg(routes);
    const mod = await loadRequest();

    expect(await mod.refreshQMCredential()).toBe(false);
    // 旧账号的 key-B 不得写回，cookie 保持手动登录的新账号凭据
    expect(mod.getQQMusicCookies().qm_keyst).toBe("key-X");
    expect(mod.getQQMusicCookies().uin).toBe("999999");
    expect(mod.getQQMusicCookies().qm_str_musicid).toBe("999999");
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(1);

    // 失败冷却不贴给新账号：随后的新账号刷新立即可执行并成功
    routes.login = () =>
      fcgJson(
        okBody({ musickey: "key-Y", str_musicid: "999999", loginType: 2, refresh_key: "rk" }),
      );
    expect(await mod.refreshQMCredential()).toBe(true);
    expect(mod.getQQMusicCookies().qm_keyst).toBe("key-Y");
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(2);
  });

  it("刷新在途期间换号后新账号立即独立刷新成功", async () => {
    setLoggedIn();
    const loginKeys: string[] = [];
    // 按 fcg 请求体分发；Login 依据在途刷新携带的凭据身份返回各自的新 key（仅 mock 虚拟值）
    state.fetchMock.mockImplementation(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as {
        request?: { module?: string; param?: { musickey?: string } };
      };
      const mod = body.request?.module ?? "";
      if (mod === SESSION_MODULE) return fcgJson(okBody({ session: { uid: "u1", sid: "s1" } }));
      if (mod === LOGIN_MODULE) {
        const inKey = body.request?.param?.musickey ?? "";
        loginKeys.push(inKey);
        await delay(20);
        // 服务端语义：刷新回显发起账号自己的 musicid
        const isA = inKey === "key-A";
        return fcgJson(
          okBody({
            musickey: isA ? "key-B" : "key-D",
            str_musicid: isA ? "123456" : "888888",
            loginType: 2,
            refresh_key: "rk-new",
          }),
        );
      }
      return fcgJson(bizBody(2001));
    });
    const mod = await loadRequest();

    // 账号 A 的请求 2001 → 刷新在途（Login 延迟 20ms）
    const first = mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {});
    await delay(2);
    // 在途期间手动换号 B → B 的请求 2001 应立即独立刷新而非复用 A 的在途 promise
    mod.mergeQQMusicCookies(manualCookies("888888", "key-C"));
    const second = mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {});
    await Promise.allSettled([first, second]);

    // 两个账号各刷新一次：B 未复用 A 的在途 promise，且各自携带自己的凭据
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(2);
    expect(loginKeys).toEqual(["key-A", "key-C"]);
    // A 的旧账号刷新结果被丢弃，B 的独立刷新结果已写回
    expect(mod.getQQMusicCookies().qm_keyst).toBe("key-D");
    expect(mod.getQQMusicCookies().uin).toBe("888888");
    await expect(first).rejects.toMatchObject({ innerCode: 2001 });
    await expect(second).rejects.toMatchObject({ innerCode: 2001 });

    // 旧账号收尾未误清新账号记录：B 刷新成功后冷却正常生效，不再发 Login
    expect(await mod.refreshQMCredential()).toBe(false);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(2);
  });

  it("匿名请求收到 2001 不触发刷新直接抛出", async () => {
    mockFcg({
      session: () => fcgJson(okBody({ session: { uid: "anon" } })),
      business: () => fcgJson(bizBody(2001)),
    });
    const mod = await loadRequest();

    const err = await catchError(mod, mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}));
    expect(err.innerCode).toBe(2001);
    expect(callsByModule(LOGIN_MODULE)).toHaveLength(0);
    expect(callsByModule(SEARCH_MODULE)).toHaveLength(1);
    // 匿名兜底 Cookie 头
    const searchCall = state.fetchMock.mock.calls.find(
      (call) => moduleOf(call as unknown[]) === SEARCH_MODULE,
    );
    expect((searchCall?.[1] as RequestInit).headers).toMatchObject({ Cookie: "tmeLoginType=-1;" });
  });

  it("网络错误限次重试后恢复，持续失败抛传输错误", async () => {
    let calls = 0;
    state.fetchMock.mockImplementation(async () => {
      calls++;
      if (calls <= 2) throw new TypeError("fetch failed");
      return fcgJson(okBody({ ok: true }));
    });
    const mod = await loadRequest();

    const data = await mod.qmRequest(
      SEARCH_MODULE,
      "DoSearchForQQMusicMobile",
      {},
      { session: false },
    );
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(3);

    // 持续失败：首次 + 2 次重试后抛出 transport 错误
    state.fetchMock.mockImplementation(async () => {
      calls++;
      throw new TypeError("fetch failed");
    });
    const err = await catchError(
      mod,
      mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}, { session: false }),
    );
    expect(err.kind).toBe("transport");
    expect(err.retryable).toBe(true);
    expect(err.status).toBe(0);
    expect(err.message).toContain("QM 网络请求失败");
    expect(calls).toBe(6);
  });

  it("HTTP 4xx 终止错误不重试", async () => {
    let calls = 0;
    state.fetchMock.mockImplementation(async () => {
      calls++;
      return new Response("forbidden", { status: 403 });
    });
    const mod = await loadRequest();

    const err = await catchError(
      mod,
      mod.qmRequest(SEARCH_MODULE, "DoSearchForQQMusicMobile", {}, { session: false }),
    );
    expect(err.kind).toBe("transport");
    expect(err.status).toBe(403);
    expect(err.retryable).toBe(false);
    expect(err.outerCode).toBe(-1);
    expect(err.innerCode).toBe(-1);
    expect(calls).toBe(1);
  });

  it("HTTP 5xx 瞬态错误限次重试后恢复", async () => {
    let calls = 0;
    state.fetchMock.mockImplementation(async () => {
      calls++;
      return calls <= 2
        ? new Response("bad gateway", { status: 502 })
        : fcgJson(okBody({ ok: true }));
    });
    const mod = await loadRequest();

    const data = await mod.qmRequest(
      SEARCH_MODULE,
      "DoSearchForQQMusicMobile",
      {},
      { session: false },
    );
    expect(data).toEqual({ ok: true });
    expect(calls).toBe(3);
  });

  it("QMRequestError 业务错误字段与消息", async () => {
    const { QMRequestError } = await loadRequest();
    const err = new QMRequestError(5, 3001);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("QM API 错误: outer=5 inner=3001");
    expect(err.kind).toBe("business");
    expect(err.outerCode).toBe(5);
    expect(err.innerCode).toBe(3001);
    expect(typeof err.outerCode).toBe("number");
    expect(typeof err.innerCode).toBe("number");
    expect(err.status).toBe(0);
    expect(err.retryable).toBe(false);
  });
});
