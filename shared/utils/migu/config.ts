/**
 * 咪咕音乐：字段形状与归一化工具（主进程与渲染进程共用）
 *
 * 只有 app.c.nf.migu.cn 的 MIGUM2.0 `search_all.do` 仍然可用（网页版 v3/v5 接口已
 * 全部改为前端路由，直接请求会 301 到 /v5/）。因此咪咕接入只做搜索：歌曲、专辑、
 * 歌手三类都有结果；歌单接口已下线，不提供。
 *
 * 搜索响应里没有时长字段，用 HQ 档的文件体积按 320kbps 反推秒数（实测与官方时长
 * 吻合，误差 1s 内），作为曲目时长兜底。
 */

/** 咪咕封面项 */
export interface MgImgItem {
  imgSizeType?: string;
  img?: string;
}

/** 咪咕歌曲（搜索接口返回，字段为官方原样） */
export interface MgSong {
  id: string;
  contentId?: string;
  copyrightId?: string;
  name: string;
  singers?: Array<{ id?: string; name: string }>;
  albums?: Array<{ id?: string; name: string }>;
  imgItems?: MgImgItem[];
  lyricUrl?: string;
  trcUrl?: string;
  rateFormats?: Array<{ formatType?: string; size?: string; fileType?: string }>;
  songAliasName?: string;
  vipType?: string;
  chargeAuditions?: string;
}

/** 咪咕专辑/歌手搜索结果 */
export interface MgAlbumItem {
  id: string;
  name: string;
  singer?: string;
  publishDate?: string;
  imgItems?: MgImgItem[];
}

export interface MgSingerItem {
  id: string;
  name: string;
}

/** 搜索响应 */
export interface MgSearchResponse {
  code: string;
  info?: string;
  songResultData?: { totalCount?: string; result?: MgSong[] };
  albumResultData?: { totalCount?: string; result?: MgAlbumItem[] };
  singerResultData?: { totalCount?: string; result?: MgSingerItem[] };
}

/**
 * 取指定尺寸的封面
 * @param items - imgItems 数组
 * @param size - 01(小) / 02(中) / 03(大)
 */
export const mgCover = (
  items: MgImgItem[] | undefined,
  size: "01" | "02" | "03" = "02",
): string => {
  if (!items?.length) return "";
  const hit = items.find((item) => item.imgSizeType === size && item.img);
  return hit?.img ?? items.find((item) => item.img)?.img ?? "";
};

/**
 * 由文件体积与码率反推时长（毫秒）
 * @param bytes - 文件字节数
 * @param bitRate - 码率（bps）
 */
const sizeToDuration = (bytes: number, bitRate: number): number =>
  bytes > 0 && bitRate > 0 ? Math.round((bytes * 8 * 1000) / bitRate) : 0;

/**
 * 估算歌曲时长（毫秒）
 *
 * 优先用 HQ(320k) 体积，其次 PQ(192k)、LQ(128k)、无损(按 44.1kHz/16bit 双声道 ≈ 1411kbps)。
 * 全部缺失时返回 0，由调用方按未知处理。
 * @param song - 咪咕歌曲
 */
export const mgDuration = (song: MgSong): number => {
  const formats = song.rateFormats ?? [];
  const find = (type: string) => formats.find((item) => item.formatType === type);
  const hq = find("HQ");
  if (hq?.size) return sizeToDuration(Number(hq.size), 320_000);
  const pq = find("PQ");
  if (pq?.size) return sizeToDuration(Number(pq.size), 192_000);
  const lq = find("LQ");
  if (lq?.size) return sizeToDuration(Number(lq.size), 128_000);
  const sq = find("SQ");
  if (sq?.size) return sizeToDuration(Number(sq.size), 1_411_000);
  return 0;
};

/**
 * 解析歌曲可用最高音质（给 UI 打标用）
 * @param song - 咪咕歌曲
 */
export const mgQuality = (
  song: MgSong,
): { codec: string; sampleRate: number; bitsPerSample: number; bitRate: number } | undefined => {
  const formats = song.rateFormats ?? [];
  const has = (type: string) => formats.some((item) => item.formatType === type);
  if (has("SQ")) return { codec: "flac", sampleRate: 44100, bitsPerSample: 16, bitRate: 0 };
  if (has("HQ")) return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 320000 };
  if (has("PQ")) return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 192000 };
  if (has("LQ")) return { codec: "mp3", sampleRate: 44100, bitsPerSample: 16, bitRate: 128000 };
  return undefined;
};

/** 判断是否 VIP 曲目 */
export const mgIsVip = (song: MgSong): boolean => song.vipType === "1";

/** 搜索开关：只开需要的类型，减少响应体积 */
export const buildSearchSwitch = (types: {
  song?: boolean;
  album?: boolean;
  singer?: boolean;
}): string =>
  JSON.stringify({
    song: types.song ? 1 : 0,
    album: types.album ? 1 : 0,
    singer: types.singer ? 1 : 0,
    tag: 0,
    playlist: 0,
    mv: 0,
    lyric: 0,
  });

/** 咪咕图片 OSS 前缀（专辑歌曲接口返回的是站内相对路径） */
const MG_IMG_BASE = "https://d.musicapp.migu.cn";

/**
 * 补全咪咕图片地址
 * @param path - 可能是完整 URL，也可能是 /data/oss/... 相对路径
 */
const fillMgImgPath = (path: string | undefined): string => {
  if (!path) return "";
  return /^https?:\/\//i.test(path) ? path : `${MG_IMG_BASE}${path}`;
};

/** 专辑歌曲条目（MIGUM3 专辑详情接口返回，字段与搜索接口不同） */
export interface MgAlbumSong {
  contentId?: string;
  songId?: string;
  copyrightId?: string;
  songName?: string;
  albumId?: string;
  album?: string;
  singerList?: Array<{ id?: string; name: string }>;
  img1?: string;
  img2?: string;
  img3?: string;
  /** 秒 */
  duration?: number;
  audioFormats?: Array<{ formatType?: string; asize?: string; isize?: string }>;
  showTags?: string[];
  lrcUrl?: string;
}

/** 专辑详情（MIGUM3 专辑信息接口） */
export interface MgAlbumDetail {
  albumId?: string;
  title?: string;
  singer?: string;
  singerId?: string;
  summary?: string;
  totalCount?: number;
  publishDate?: string;
  imgItems?: MgImgItem[];
}

/** 专辑详情响应 */
export interface MgAlbumDetailResponse {
  code: string;
  info?: string;
  data?: MgAlbumDetail;
}

/** 专辑歌曲响应 */
export interface MgAlbumSongsResponse {
  code: string;
  info?: string;
  data?: { songList?: MgAlbumSong[]; totalCount?: number; hasNext?: boolean };
}

/**
 * 专辑歌曲 → 搜索歌曲形状（复用同一套 Track 归一化）
 * @param song - MIGUM3 专辑歌曲
 */
export const mgAlbumSongToSong = (song: MgAlbumSong): MgSong => ({
  id: song.songId ?? "",
  contentId: song.contentId ?? song.songId ?? "",
  copyrightId: song.copyrightId,
  name: song.songName ?? "",
  singers: song.singerList ?? [],
  albums: [{ id: song.albumId, name: song.album ?? "" }],
  // 专辑歌曲接口返回的 img1/img2/img3 是站内相对路径，补全 CDN 前缀
  imgItems: [
    { imgSizeType: "01", img: fillMgImgPath(song.img1) },
    { imgSizeType: "02", img: fillMgImgPath(song.img2 ?? song.img1) },
    { imgSizeType: "03", img: fillMgImgPath(song.img3 ?? song.img2 ?? song.img1) },
  ].filter((item) => item.img),
  rateFormats: (song.audioFormats ?? []).map((format) => ({
    formatType: format.formatType,
    size: format.asize ?? format.isize,
  })),
  vipType: song.showTags?.includes("vip") ? "1" : "0",
});

/** 专辑歌曲时长：优先官方 duration（秒），缺失时按体积反推 */
export const mgAlbumSongDuration = (song: MgAlbumSong): number =>
  song.duration && song.duration > 0 ? song.duration * 1000 : mgDuration(mgAlbumSongToSong(song));
