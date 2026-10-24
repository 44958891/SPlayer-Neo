import type { MgAlbumSong, MgSong } from "@shared/utils/migu/config";
import { describe, expect, it } from "vitest";
import {
  mgAlbumSongDuration,
  mgAlbumSongToSong,
  mgCover,
  mgDuration,
  mgQuality,
} from "@shared/utils/migu/config";
import { mgSongToTrack } from "./migu";

/** 从请求字节数与码率反推的时长应与官方值接近（±3s） */
describe("migu 归一化", () => {
  it("用 HQ 体积反推时长，缺失时逐级回落", () => {
    const hq: MgSong = {
      id: "1",
      name: "晴天",
      rateFormats: [{ formatType: "HQ", size: "10792962" }],
    };
    // 10792962 字节 @320kbps ≈ 269.8s
    expect(Math.abs(mgDuration(hq) / 1000 - 270)).toBeLessThan(3);

    const pq: MgSong = {
      id: "2",
      name: "晴天",
      rateFormats: [{ formatType: "PQ", size: "4317311" }],
    };
    expect(Math.abs(mgDuration(pq) / 1000 - 180)).toBeLessThan(3);

    const empty: MgSong = { id: "3", name: "无音质信息" };
    expect(mgDuration(empty)).toBe(0);
  });

  it("音质按 SQ > HQ > PQ > LQ 取最高", () => {
    expect(mgQuality({ id: "1", name: "a", rateFormats: [{ formatType: "SQ" }] })?.codec).toBe(
      "flac",
    );
    expect(mgQuality({ id: "1", name: "a", rateFormats: [{ formatType: "HQ" }] })?.bitRate).toBe(
      320000,
    );
    expect(mgQuality({ id: "1", name: "a", rateFormats: [{ formatType: "LQ" }] })?.bitRate).toBe(
      128000,
    );
    expect(mgQuality({ id: "1", name: "a" })).toBeUndefined();
  });

  it("封面按尺寸取，缺档位时回落首个可用图", () => {
    expect(
      mgCover([
        { imgSizeType: "01", img: "small" },
        { imgSizeType: "02", img: "mid" },
      ]),
    ).toBe("mid");
    expect(mgCover([{ imgSizeType: "01", img: "only" }])).toBe("only");
    expect(mgCover(undefined)).toBe("");
  });

  it("搜索歌曲转 Track：标题用中文名，copyrightId 进 extId", () => {
    const track = mgSongToTrack({
      id: "3790007",
      contentId: "600902000006889366",
      copyrightId: "60054701923",
      name: "晴天",
      songAliasName: "Sunny Day",
      singers: [{ id: "112", name: "周杰伦" }],
      albums: [{ id: "8592", name: "叶惠美" }],
      imgItems: [{ imgSizeType: "02", img: "https://x/cover.webp" }],
      rateFormats: [{ formatType: "HQ", size: "10792962" }],
      vipType: "1",
    });
    expect(track.id).toBe("600902000006889366");
    expect(track.title).toBe("晴天");
    expect(track.extId).toBe("60054701923");
    expect(track.artists[0]).toEqual({ id: "112", name: "周杰伦" });
    expect(track.album).toEqual({ id: "8592", name: "叶惠美" });
    expect(track.cover).toBe("https://x/cover.webp");
    expect(track.fee).toBe(1);
  });

  it("专辑歌曲：相对图片补全 CDN 前缀，时长优先官方值", () => {
    const song: MgAlbumSong = {
      contentId: "600902000006889374",
      songId: "2261",
      copyrightId: "60054701921",
      songName: "以父之名",
      albumId: "8592",
      album: "叶惠美",
      singerList: [{ id: "112", name: "周杰伦" }],
      img1: "/data/oss/resource/00/4t/9y/a.webp",
      img2: "/data/oss/resource/00/4t/9y/b.webp",
      duration: 342,
      audioFormats: [{ formatType: "SQ", asize: "34944457" }],
    };
    const track = mgSongToTrack(mgAlbumSongToSong(song));
    expect(track.cover).toBe("https://d.musicapp.migu.cn/data/oss/resource/00/4t/9y/b.webp");
    expect(mgAlbumSongDuration(song)).toBe(342000);
    expect(mgAlbumSongDuration({ ...song, duration: 0 })).toBeGreaterThan(190000);
  });
});
