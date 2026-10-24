/**
 * 酷我请求层
 *
 * 统一注入伪装头、超时与伪 JSON 解析；不同接口返回值形状不同，由调用方按模块声明类型。
 */

import { getSessionCookies } from "@main/database/sessions";
import { KW_HEADERS, parseKwJson } from "./config";

/** 已登录会话拼成 Cookie 头（未登录返回空串） */
export const kuwoCookieHeader = (): string => {
  const session = getSessionCookies("kuwo");
  return Object.entries(session)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
};

interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * 基础 GET 请求并解析伪 JSON
 * @param url - 完整请求地址
 * @param options - 请求配置
 */
export const kwRequest = async <T = Record<string, unknown>>(
  url: string,
  options: FetchOptions = {},
): Promise<T> => {
  const cookie = kuwoCookieHeader();
  const res = await fetch(url, {
    method: "GET",
    headers: { ...KW_HEADERS, ...(cookie ? { Cookie: cookie } : {}), ...options.headers },
    signal: options.signal ?? AbortSignal.timeout(10000),
  });
  if (res.status !== 200) throw new Error(`KW HTTP ${res.status}`);
  const text = await res.text();
  return parseKwJson<T>(text);
};
