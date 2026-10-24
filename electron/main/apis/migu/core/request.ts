/**
 * 咪咕请求层
 *
 * 统一注入伪装头、超时与响应校验；接口返回 `code === "000000"` 视为成功。
 */

import { MG_HEADERS } from "./config";
import type { MgSearchResponse } from "@shared/utils/migu/config";

/** 咪咕业务错误（code 非 000000） */
export class MiguRequestError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`migu ${code}: ${message}`);
    this.name = "MiguRequestError";
    this.code = code;
  }
}

/**
 * GET 请求并解析 JSON
 * @param url - 完整请求地址
 * @param signal - 取消信号
 */
export const mgRequest = async <T = MgSearchResponse>(
  url: string,
  signal?: AbortSignal,
): Promise<T> => {
  const res = await fetch(url, {
    method: "GET",
    headers: MG_HEADERS,
    signal: signal ?? AbortSignal.timeout(10_000),
  });
  if (res.status !== 200) throw new Error(`MG HTTP ${res.status}`);
  const text = await res.text();
  if (!text.trim()) throw new Error("empty migu response");
  return JSON.parse(text) as T;
};

/**
 * 请求搜索接口并校验业务码
 * @param url - 完整请求地址
 * @param signal - 取消信号
 */
export const mgSearch = async (url: string, signal?: AbortSignal): Promise<MgSearchResponse> => {
  const body = await mgRequest<MgSearchResponse>(url, signal);
  if (body.code !== "000000") throw new MiguRequestError(body.code, body.info ?? "unknown");
  return body;
};
