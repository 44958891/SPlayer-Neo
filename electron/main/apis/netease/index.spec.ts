// @vitest-environment node
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cacheClear } from "./core/cache";
import { NeteaseRequestError } from "./core/request";
import {
  callNetease,
  clearNeteaseCookies,
  ensureNeteaseAnonymousSession,
  getNeteaseCookies,
  setNeteaseCookies,
} from "./index";

const state = vi.hoisted(() => ({
  modules: {} as Record<string, (...args: unknown[]) => Promise<unknown>>,
  dbSession: {} as Record<string, string>,
  saved: [] as Array<Record<string, string>>,
}));

vi.mock("./modules", () => ({ modules: state.modules }));

vi.mock("@main/database/sessions", () => ({
  getSessionCookies: () => state.dbSession,
  saveSessionCookies: (_platform: string, cookies: Record<string, string>) => {
    state.saved.push({ ...cookies });
    for (const [k, v] of Object.entries(cookies)) state.dbSession[k] = v;
  },
  clearSessionCookies: () => {
    for (const key of Object.keys(state.dbSession)) delete state.dbSession[key];
  },
}));

vi.mock("@main/store", () => ({ store: { get: () => false } }));

vi.mock("@main/utils/logger", () => ({
  neteaseLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  systemLog: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@main/utils/proxy", () => ({ fetchWithProxy: vi.fn() }));

vi.mock("./core/request", () => {
  class MockNeteaseRequestError extends Error {
    readonly response: { status: number; body: Record<string, unknown>; cookie: string[] };
    constructor(response: { status: number; body: Record<string, unknown>; cookie: string[] }) {
      super(`netease ${response.body?.code ?? response.status}`);
      this.name = "NeteaseRequestError";
      this.response = response;
    }
  }
  return { createRequest: vi.fn(), NeteaseRequestError: MockNeteaseRequestError };
});

/** 注册匿名接口 mock：临时 400 无 token 响应 */
const registerMissing = (): Record<string, unknown> => ({
  status: 200,
  body: { code: 400 },
  cookie: [],
});

/** 注册匿名接口 mock：成功响应，token 经 set-cookie MUSIC_A 下发（body 无 token 字段） */
const registerOk = (): Record<string, unknown> => ({
  status: 200,
  body: { code: 200, userId: 1, createTime: 1 },
  cookie: [
    `MUSIC_A=anon-token-${state.saved.length}; Path=/; HttpOnly`,
    "__csrf=fake-csrf; Path=/",
  ],
});

/** 设置 register_anonimous 实现 */
const setRegister = (impl: (...args: unknown[]) => Promise<unknown>): void => {
  state.modules["register_anonimous"] = vi.fn(impl);
};

const registerFn = (): Mock => state.modules["register_anonimous"] as Mock;

/** 设置业务接口（personalized）mock，返回固定成功体 */
const setPersonalized = (): Mock => {
  const fn = vi.fn(async () => ({ status: 200, body: { code: 200, result: { ok: true } } }));
  state.modules["personalized"] = fn;
  return fn;
};

/** 网络不可达类错误（请求层重试耗尽后的 502） */
const networkError = (): NeteaseRequestError =>
  new NeteaseRequestError({ status: 502, body: { code: 502, msg: "fetch failed" }, cookie: [] });

describe("netease 匿名会话初始化", () => {
  beforeEach(() => {
    for (const key of Object.keys(state.modules)) delete state.modules[key];
    state.dbSession = {};
    state.saved = [];
    cacheClear();
    clearNeteaseCookies();
  });

  it("首次 400 无 token 后重试成功：四路并发共享单飞且主页调用成功", async () => {
    setRegister(async () =>
      registerFn().mock.calls.length === 1 ? registerMissing() : registerOk(),
    );
    const personalized = setPersonalized();
    const results = await Promise.all([
      callNetease("personalized", { k: 0 }),
      callNetease("personalized", { k: 1 }),
      callNetease("personalized", { k: 2 }),
      callNetease("personalized", { k: 3 }),
    ]);
    expect(registerFn()).toHaveBeenCalledTimes(2);
    expect(results).toHaveLength(4);
    for (const r of results) expect(r.body).toEqual({ code: 200, result: { ok: true } });
    expect(personalized).toHaveBeenCalledTimes(4);
    expect(getNeteaseCookies().MUSIC_A).toContain("anon-token");
    expect(state.dbSession.MUSIC_A).toContain("anon-token");
    expect(state.dbSession.deviceId).toBeTruthy();
  });

  it("连续 400 无 token：最多总 3 次后有限失败且不伪造游客", async () => {
    setRegister(async () => registerMissing());
    setPersonalized();
    await expect(
      Promise.all([callNetease("personalized", { k: 0 }), callNetease("personalized", { k: 1 })]),
    ).rejects.toThrow("netease anonymous registration missing MUSIC_A");
    expect(registerFn()).toHaveBeenCalledTimes(3);
    expect(state.saved).toHaveLength(0);
    expect(getNeteaseCookies().MUSIC_A).toBeUndefined();
  });

  it("并发单飞只注册一次", async () => {
    setRegister(async () => registerOk());
    await Promise.all([
      ensureNeteaseAnonymousSession(),
      ensureNeteaseAnonymousSession(),
      ensureNeteaseAnonymousSession(),
    ]);
    expect(registerFn()).toHaveBeenCalledTimes(1);
    expect(state.saved).toHaveLength(1);
  });

  it("已有游客态不注册", async () => {
    setNeteaseCookies({ MUSIC_A: "anon-existing" });
    const personalized = setPersonalized();
    await callNetease("personalized", { k: 0 });
    expect(registerFn()).toBeUndefined();
    expect(personalized.mock.calls[0][0].cookie.MUSIC_A).toBe("anon-existing");
  });

  it("已有登录态不注册且带 MUSIC_U", async () => {
    setNeteaseCookies({ MUSIC_U: "u1" });
    const personalized = setPersonalized();
    await callNetease("personalized", { k: 0 });
    expect(registerFn()).toBeUndefined();
    expect(personalized.mock.calls[0][0].cookie.MUSIC_U).toBe("u1");
  });

  it("重试期间换号：不回写游客态、不覆盖登录会话", async () => {
    setRegister(async () => {
      if (registerFn().mock.calls.length === 1) {
        setNeteaseCookies({ MUSIC_U: "u2", deviceId: "d2" });
        return registerMissing();
      }
      return registerOk();
    });
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).resolves.toMatchObject({
      body: { code: 200 },
    });
    expect(registerFn()).toHaveBeenCalledTimes(1);
    expect(getNeteaseCookies().MUSIC_U).toBe("u2");
    expect(getNeteaseCookies().MUSIC_A).toBeUndefined();
    expect(state.saved.every((cookies) => !cookies.MUSIC_A)).toBe(true);
  });

  it("返回 512 无 token：立即失败只注册一次", async () => {
    setRegister(async () => ({ status: 200, body: { code: 512 }, cookie: [] }));
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).rejects.toThrow(/missing MUSIC_A/);
    expect(registerFn()).toHaveBeenCalledTimes(1);
    expect(state.saved).toHaveLength(0);
  });

  it("clear 会话后代次变更：旧注册放弃不回写，新请求重新初始化", async () => {
    setRegister(async () => {
      if (registerFn().mock.calls.length === 1) {
        clearNeteaseCookies();
        return registerMissing();
      }
      return registerOk();
    });
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).resolves.toMatchObject({
      body: { code: 200 },
    });
    expect(registerFn()).toHaveBeenCalledTimes(1);
    expect(getNeteaseCookies().MUSIC_A).toBeUndefined();
    await expect(callNetease("personalized", { k: 1 })).resolves.toMatchObject({
      body: { code: 200 },
    });
    expect(registerFn()).toHaveBeenCalledTimes(2);
    expect(getNeteaseCookies().MUSIC_A).toContain("anon-token");
  });

  it("set 新游客 MUSIC_A 后旧注册放弃且不覆盖新会话", async () => {
    setRegister(async () => {
      if (registerFn().mock.calls.length === 1) {
        setNeteaseCookies({ MUSIC_A: "anon-new" });
        return registerMissing();
      }
      return registerOk();
    });
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).resolves.toMatchObject({
      body: { code: 200 },
    });
    expect(registerFn()).toHaveBeenCalledTimes(1);
    expect(getNeteaseCookies().MUSIC_A).toBe("anon-new");
    expect(state.saved.every((c) => !String(c.MUSIC_A ?? "").includes("anon-token"))).toBe(true);
  });

  it("网络类失败有限重试后成功", async () => {
    setRegister(async () => {
      if (registerFn().mock.calls.length === 1) throw networkError();
      return registerOk();
    });
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).resolves.toMatchObject({
      body: { code: 200 },
    });
    expect(registerFn()).toHaveBeenCalledTimes(2);
    expect(getNeteaseCookies().MUSIC_A).toContain("anon-token");
  });

  it("不可重试业务错误立即终止不再重试", async () => {
    setRegister(async () => {
      throw new NeteaseRequestError({ status: 512, body: { code: 512 }, cookie: [] });
    });
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).rejects.toThrow("netease 512");
    expect(registerFn()).toHaveBeenCalledTimes(1);
    expect(state.saved).toHaveLength(0);
  });

  it("普通异常不重试立即抛出", async () => {
    setRegister(async () => {
      throw new Error("boom");
    });
    setPersonalized();
    await expect(callNetease("personalized", { k: 0 })).rejects.toThrow("boom");
    expect(registerFn()).toHaveBeenCalledTimes(1);
  });
});
