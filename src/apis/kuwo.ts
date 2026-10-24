/**
 * KW API 渲染端
 *
 * 用 Proxy 代理所有接口到主进程：`kuwo.search({keywords})` 等于
 * `window.api.apis.call("kuwo", "search", {keywords})`。
 *
 * 调用约定：成功 → 返回 data；失败 → 抛 Error。
 */

import type { ApiCallResponse } from "@shared/types/apis";

/**
 * 调用 KW API，返回业务数据
 * @param name - 接口名（search / album / artist / playlist / song_url）
 * @param params - 接口参数
 */
export const kuwoCall = async <T = unknown>(
  name: string,
  params?: Record<string, unknown>,
): Promise<T> => {
  const res: ApiCallResponse = await window.api.apis.call("kuwo", name, params);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
};

type KuwoProxy = Record<string, <T = unknown>(params?: Record<string, unknown>) => Promise<T>>;

/** 任意方法调用：`kuwo.search(...)` / `kuwo.song_url(...)` */
export const kuwo: KuwoProxy = new Proxy({} as KuwoProxy, {
  get:
    (_t, name: string) =>
    <T = unknown>(params?: Record<string, unknown>) =>
      kuwoCall<T>(name, params),
});
