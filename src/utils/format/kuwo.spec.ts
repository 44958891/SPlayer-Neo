import { describe, expect, it } from "vitest";
import type { Track } from "@shared/types/player";
import { kwFormatsToQuality, kwSongToTrack, kwAlbumToCoverItem } from "./kuwo";

const song = (over: Partial<Parameters<typeof kwSongToTrack>[0]> = {}) => ({
  id: "51685512",
  name: "晴天",
  artist: "周杰伦",
  artists: [{ id: "336", name: "周杰伦" }],
  album: "叶惠美",
  albumId: "1023",
  duration: 269000,
  formats: "AAC48|MP3128",
  ...over,
});

describe("kwFormatsToQuality", () => {
  it("ALFLAC → 无损 flac", () => {
    expect(kwFormatsToQuality("AAC48|ALFLAC|MP3128")).toMatchObject({ codec: "flac" });
  });
  it("MP3H → 320k mp3", () => {
    expect(kwFormatsToQuality("MP3128|MP3H")).toMatchObject({ codec: "mp3", bitRate: 320000 });
  });
  it("仅 128k → 128k mp3", () => {
    expect(kwFormatsToQuality("AAC48|MP3128")).toMatchObject({ codec: "mp3", bitRate: 128000 });
  });
  it("空值 → undefined", () => {
    expect(kwFormatsToQuality(undefined)).toBeUndefined();
  });
});

describe("kwSongToTrack", () => {
  it("映射歌手与专辑，并带出声明音质", () => {
    const track: Track = kwSongToTrack(song());
    expect(track).toMatchObject({
      id: "51685512",
      source: "kuwo",
      title: "晴天",
      duration: 269000,
    });
    expect(track.artists).toEqual([{ id: "336", name: "周杰伦" }]);
    expect(track.album).toEqual({ id: "1023", name: "叶惠美" });
    expect(track.quality).toMatchObject({ codec: "mp3", bitRate: 128000 });
  });

  it("缺 artists 时用 artist 字符串兜底", () => {
    const track = kwSongToTrack(song({ artists: undefined, artist: "周杰伦" }));
    expect(track.artists).toEqual([{ id: "周杰伦", name: "周杰伦" }]);
  });
});

describe("kwAlbumToCoverItem", () => {
  it("歌手写入 subtitle", () => {
    const item = kwAlbumToCoverItem({
      id: "10231716",
      name: "一个人记得",
      artist: "尤长靖",
      cover: "https://example.test/cover.jpg",
      trackCount: 2,
    });
    expect(item).toMatchObject({
      id: "10231716",
      title: "一个人记得",
      subtitle: "尤长靖",
      trackCount: 2,
    });
  });
});
