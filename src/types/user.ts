/**
 * 用户登录相关类型
 */

/** 用户基础资料 */
export interface UserProfile {
  userId: number;
  nickname: string;
  avatarUrl?: string;
  backgroundUrl?: string;
  signature?: string;
  /** 会员类型：0/缺失=未开通，10/100 及其他非 0=普通会员（CVIP），11/110=超级会员（SVIP） */
  vipType?: number;
  gender?: number;
  province?: number;
  city?: number;
}

/** 用户订阅计数（/user/subcount） */
export interface UserSubcount {
  /** 自建歌单数 */
  createdPlaylistCount: number;
  /** 收藏歌单数 */
  subPlaylistCount: number;
  /** 收藏歌手数 */
  artistCount: number;
}
