import type { Track } from "@shared/types/player";
import { describe, expect, it } from "vitest";
import { buildLocalMatchIndex, findLocalMatch } from "./localMatch";

const track = (id: string, title: string, artists: string[], duration = 240_000): Track => ({
  id,
  source: "local",
  title,
  artists: artists.map((name) => ({ name })),
  duration,
});

const online = (id: string, title: string, artists: string[], duration = 240_000): Track => ({
  id,
  source: "netease",
  title,
  artists: artists.map((name) => ({ name })),
  duration,
});

describe("localMatch", () => {
  it("标题忽略大小写/空白/括号后命中，耐歌手与时长差", () => {
    const index = buildLocalMatchIndex([track("1", "海屿你", ["马也_Crabbit"], 244_000)]);
    expect(findLocalMatch(index, online("x", " 海屿你 ", ["马也_Crabbit"], 241_000))?.id).toBe("1");
  });

  it("歌手无交集时不命中", () => {
    const index = buildLocalMatchIndex([track("1", "晴天", ["周杰伦"])]);
    expect(findLocalMatch(index, online("x", "晴天", ["孙燕姿"]))).toBeNull();
  });

  it("时长超过 5s 视作不同版本", () => {
    const index = buildLocalMatchIndex([track("1", "晴天", ["周杰伦"], 240_000)]);
    expect(findLocalMatch(index, online("x", "晴天", ["周杰伦"], 250_000))).toBeNull();
    expect(findLocalMatch(index, online("y", "晴天", ["周杰伦"], 244_000))?.id).toBe("1");
  });

  it("任一侧缺歌手或时长时放宽（只按标题）", () => {
    const index = buildLocalMatchIndex([track("1", "海屿你", [], 0)]);
    expect(findLocalMatch(index, online("x", "海屿你", ["马也_Crabbit"], 240_000))?.id).toBe("1");
  });

  it("括号内容不参与比较（原版与 Live 版按标题同桶，歌手时长兜底）", () => {
    const index = buildLocalMatchIndex([track("1", "晴天 (Live)", ["周杰伦"], 200_000)]);
    expect(findLocalMatch(index, online("x", "晴天", ["周杰伦"], 200_000))?.id).toBe("1");
  });

  it("多歌手任一同名即视为同曲", () => {
    const index = buildLocalMatchIndex([track("1", "Six Degrees", ["派伟俊", "周杰伦"])]);
    expect(findLocalMatch(index, online("x", "Six Degrees", ["周杰伦"]))?.id).toBe("1");
  });
});
