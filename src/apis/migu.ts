/**
 * Migu API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`migu.search({keywords})` 等于
 * `window.api.apis.call("migu", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用咪咕 API，返回业务数据
 * @param name - 接口名（当前仅 search）
 * @param params - 接口参数
 */
export const miguCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("migu", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type MiguProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`migu.search(...)` */
export const migu: MiguProxy = new Proxy({} as MiguProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      miguCall<T>(name, params),
});
