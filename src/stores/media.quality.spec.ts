import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { AudioQuality, Track, TrackDetail } from "@shared/types/player";
import type { QualityProvenance } from "@shared/types/quality";
import { resolveQualityBadge } from "@shared/utils/qualityProvenance";

vi.mock("@/services/lyric/loader", () => ({ watchLyricPreference: vi.fn() }));
vi.mock("@/stores/settings", () => ({
  useSettingsStore: () => ({ lyric: { cjkTransform: "none" } }),
}));
import { useMediaStore } from "./media";

const master: AudioQuality = {
  codec: "flac",
  sampleRate: 192000,
  bitsPerSample: 24,
  bitRate: 6000000,
  channels: 2,
};
const lossless: AudioQuality = { ...master, sampleRate: 44100, bitsPerSample: 16 };
const provenance: QualityProvenance = {
  provider: "official",
  platform: "netease",
  nativeTier: "jymaster",
  level: "jymaster",
  evidence: "response",
};
const track: Track = {
  id: "a",
  title: "A",
  artists: [],
  source: "netease",
  duration: 1000,
  quality: master,
  qualityProvenance: provenance,
};
const detail: TrackDetail = { quality: master, qualityProvenance: provenance, externalLyrics: [] };

describe("当前播放音质状态", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("切到新歌立即清空旧歌详情，加载期间不出现上一首的母带徽标", () => {
    const media = useMediaStore();
    media.setTrack(track, detail);
    media.setTrack({
      ...track,
      id: "b",
      title: "B",
      qualityProvenance: undefined,
      quality: lossless,
    });
    expect(media.detail).toBeNull();
    expect(
      resolveQualityBadge(media.track?.quality, media.track?.qualityProvenance).tier,
    ).toBeUndefined();
  });

  it("同一首歌更新收藏保留实测来源，显式重载时清空详情", () => {
    const media = useMediaStore();
    media.setTrack(track, detail);
    media.setTrack({ ...track, favorite: true });
    expect(media.detail?.qualityProvenance).toEqual(provenance);
    media.setTrack(track, null);
    expect(media.detail).toBeNull();
  });

  it("本次实测参数覆盖目录声明，未知新音源清除旧来源", () => {
    const media = useMediaStore();
    media.setTrack(track, detail);
    media.enrichTrack(
      { duration: 1000, quality: lossless },
      { quality: lossless, externalLyrics: [] },
    );
    expect(media.track?.quality).toEqual(lossless);
    expect(media.track?.qualityProvenance).toBeUndefined();
    expect(
      resolveQualityBadge(media.detail?.quality, media.detail?.qualityProvenance),
    ).toMatchObject({ level: "lossless", tier: undefined });
  });

  it("换源后只保留本次确认的平台音质，歌曲身份仍来自原目录", () => {
    const media = useMediaStore();
    const qq: QualityProvenance = {
      provider: "plugin",
      pluginId: "p",
      platform: "qqmusic",
      nativeTier: "臻品母带2.0",
      level: "jymaster",
      evidence: "plugin",
    };
    media.setTrack(track);
    media.enrichTrack(
      { duration: 1000, quality: master, qualityProvenance: qq },
      { quality: master, qualityProvenance: qq, externalLyrics: [] },
    );
    expect(media.track?.source).toBe("netease");
    expect(media.track?.id).toBe("a");
    expect(resolveQualityBadge(media.detail?.quality, media.detail?.qualityProvenance).tier).toBe(
      "qq-master",
    );
  });
});
