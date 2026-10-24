import { kuwoCall } from "@/apis/kuwo";
import type { PlatformProfile } from "@shared/types/platform";

interface UserInfoResponse {
  code?: number;
  data?: {
    userid?: number | string;
    uname?: string;
    nickname?: string;
    pic3?: string;
    pic?: string;
    vip?: number | string;
  } | null;
}

/** 酷我网页登录（官方弹层） */
export const openKuwoWebLogin = async (): Promise<boolean> => {
  const result = await window.api.apis.openLoginWeb("kuwo");
  return result.ok;
};

/**
 * 读取酷我登录态
 * 酷我账号信息接口对未登录请求返回空 data 或 code!=200
 */
export const fetchKuwoLoginStatus = async (): Promise<PlatformProfile | null> => {
  try {
    const body = await kuwoCall<UserInfoResponse>("user_info", { timestamp: Date.now() });
    const data = body?.data;
    const userId = data?.userid ? String(data.userid) : "";
    if (!userId || userId === "0") return null;
    return {
      userId,
      nickname: data?.uname ?? data?.nickname ?? userId,
      avatarUrl: data?.pic3 ?? data?.pic ?? "",
      isVip: Number(data?.vip ?? 0) > 0,
    };
  } catch {
    return null;
  }
};

export const logoutKuwo = async (): Promise<void> => {
  await window.api.apis.clearSession("kuwo");
};

export const setKuwoCookie = async (cookie: string): Promise<boolean> => {
  const result = await window.api.apis.setCookie("kuwo", cookie);
  return result.ok;
};
