import type { Track } from "@shared/types/player";
import { describe, expect, it } from "vitest";
import { sortTracks } from "./trackSort";

const track = (id: string, patch: Partial<Track> = {}): Track => ({
  id,
  source: "local",
  title: id,
  artists: [{ name: "未知" }],
  duration: 1000,
  ...patch,
});

describe("sortTracks", () => {
  it("默认排序保持原顺序且不修改入参", () => {
    const input = [track("b"), track("a")];
    const out = sortTracks(input, "none", "asc");
    expect(out.map((t) => t.id)).toEqual(["b", "a"]);
    expect(out).not.toBe(input);
  });

  it("按标题自然序（忽略大小写、数字按数值）", () => {
    const input = [track("t10", { title: "Track 10" }), track("t2", { title: "track 2" })];
    expect(sortTracks(input, "title", "asc").map((t) => t.title)).toEqual(["track 2", "Track 10"]);
    expect(sortTracks(input, "title", "desc").map((t) => t.title)).toEqual(["Track 10", "track 2"]);
  });

  it("按歌手、专辑、时长、大小、修改时间排序", () => {
    const a = track("a", { artists: [{ name: "B" }], album: { name: "Z" }, duration: 300 });
    const b = track("b", { artists: [{ name: "A" }], album: { name: "Y" }, duration: 100 });
    expect(sortTracks([a, b], "artist", "asc").map((t) => t.id)).toEqual(["b", "a"]);
    expect(sortTracks([a, b], "album", "asc").map((t) => t.id)).toEqual(["b", "a"]);
    expect(sortTracks([a, b], "duration", "asc").map((t) => t.id)).toEqual(["b", "a"]);
    expect(
      sortTracks([track("x", { fileSize: 9 }), track("y", { fileSize: 1 })], "size", "asc").map(
        (t) => t.id,
      ),
    ).toEqual(["y", "x"]);
    expect(
      sortTracks([track("x", { mtime: 9 }), track("y", { mtime: 1 })], "mtime", "desc").map(
        (t) => t.id,
      ),
    ).toEqual(["x", "y"]);
  });

  it("同值按标题、id 兜底，保证顺序稳定可复现", () => {
    const input = [track("b", { title: "同" }), track("a", { title: "同" })];
    expect(sortTracks(input, "duration", "asc").map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("按曲目编号排序（缺省按 0）", () => {
    const input = [track("c", { track: 3 }), track("a", { track: 1 }), track("n")];
    expect(sortTracks(input, "track", "asc").map((t) => t.id)).toEqual(["n", "a", "c"]);
  });
});
