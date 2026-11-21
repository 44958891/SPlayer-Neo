import type { MediaInfo, PlaybackContext, Track, TrackDetail } from "@shared/types/player";
import type { PlaybackQualityStatus } from "@shared/types/playbackQuality";
import type { LyricData, LyricFormat, LyricInput, LyricLine } from "@shared/types/lyrics";
import { useSettingsStore } from "@/stores/settings";
import { watchLyricPreference } from "@/services/lyric/loader";
import {
  applyLyricLanguages,
  extractLyricAuthors,
  findLyricIndex,
  normalizeLyricLines,
  parseLyric,
} from "lyric-kit";
import { applyLyricExclude } from "@/utils/lyric/lyricStripper";
import { applyLyricCjkTransform } from "@/utils/lyric/cjkTransform";

export const useMediaStore = defineStore("media", () => {
  watchLyricPreference();

  /** 当前歌曲轻量信息 */
  const track = shallowRef<Track | null>(null);

  /** 当前播放的来源上下文 */
  const playbackContext = shallowRef<PlaybackContext>();

  /** 当前歌曲详细信息 */
  const detail = shallowRef<TrackDetail | null>(null);

  /** 当前选中的歌词数据 */
  const activeLyric = ref<LyricData>(null);

  /** 当前歌词原始内容 */
  const lyricContent = ref<LyricInput | null>(null);

  /** 歌词是否正在加载 */
  const lyricLoading = ref(false);

  /** 当前歌词行索引，-1 表示无匹配 */
  const lyricIndex = ref(-1);

  /** 当前歌词格式 */
  const lyricFormat = computed((): LyricFormat | null => activeLyric.value?.format ?? null);

  /** 当前歌词解析结果 */
  const parsedLyric = shallowRef<LyricLine[]>([]);

  /** 当前歌词文件制作者列表 */
  const lyricAuthors = ref<string[]>([]);

  /** 同步当前歌词源到主进程 */
  const syncToMain = (): void => {
    try {
      const payload = {
        track: track.value ? toRaw(track.value) : null,
        lyric: toRaw(parsedLyric.value),
        source: activeLyric.value ? toRaw(activeLyric.value) : null,
      };
      window.api.nowPlaying.update(payload);
    } catch (error) {
      console.error("[media] syncToMain failed", error);
    }
  };

  /**
   * 更新 track
   * @param newTrack - 新的歌曲信息
   * @param newDetail - 本次详情，传 null 开始重新加载；同曲元数据更新时省略则保留实测信息
   */
  const setTrack = (newTrack: Track, newDetail?: TrackDetail | null): void => {
    const current = track.value;
    const sameTrack =
      current &&
      current.id === newTrack.id &&
      current.source === newTrack.source &&
      current.serverId === newTrack.serverId &&
      current.path === newTrack.path &&
      current.plugin?.pluginId === newTrack.plugin?.pluginId &&
      current.plugin?.source === newTrack.plugin?.source;
    track.value = newTrack;
    if (newDetail !== undefined || !sameTrack) detail.value = newDetail ?? null;
  };

  /**
   * 更新当前播放的来源上下文
   * @param context - 播放来源上下文
   */
  const setPlaybackContext = (context?: PlaybackContext): void => {
    playbackContext.value = context;
  };

  /**
   * 把 audio-engine 解析出的元数据合并到当前 Track 上
   * 保留身份字段（id/source/serverId/originalId/platform/path）
   * 音质使用本次解码结果，来源依据由本次加载回传，避免旧目录档位覆盖真实文件
   * streaming 源的 cover/title/artist/album 保留服务器返回值
   * @param info - 引擎实测参数与本次来源
   * @param newDetail - 本次文件详情
   */
  const enrichTrack = (info: MediaInfo, newDetail?: TrackDetail): void => {
    if (!track.value) return;
    const isStreaming = track.value.source === "streaming";
    // 标题为文件名去后缀派生（如拖拽播放）时，让位给引擎提取的内嵌标签标题
    const fileName = track.value.path?.split(/[\\/]/).pop() ?? "";
    const stem = fileName.replace(/\.[^.]+$/, "");
    const hasExplicitTitle = !!track.value.title && track.value.title !== stem;
    const hasExplicitArtists = track.value.artists && track.value.artists.length > 0;
    track.value = {
      ...track.value,
      title: hasExplicitTitle ? track.value.title : info.title || track.value.title,
      artists: hasExplicitArtists
        ? track.value.artists
        : info.artists && info.artists.length > 0
          ? info.artists
          : track.value.artists,
      album: track.value.album ?? info.album,
      duration: track.value.duration > 0 ? track.value.duration : info.duration,
      cover: isStreaming ? track.value.cover : (track.value.cover ?? info.cover),
      quality: info.quality ?? newDetail?.quality ?? track.value.quality,
      qualityProvenance: newDetail?.qualityProvenance ?? info.qualityProvenance,
    };
    if (newDetail) detail.value = newDetail;
  };

  /**
   * 兜底封面：当前 track 无封面时把插件命中的远端 URL 填进去
   * 同时写 cover 与 coverOriginal，使全屏大图与背景/取色一并补上；已有封面不覆盖
   * @param url - 封面图片 URL
   */
  const patchCover = (url: string): void => {
    if (!track.value) return;
    if (track.value.cover && track.value.coverOriginal) return;
    track.value = {
      ...track.value,
      cover: track.value.cover || url,
      coverOriginal: track.value.coverOriginal || url,
    };
  };

  /**
   * 补写当前详情的播放档位对照结论
   * 主进程未随 LoadResult 下发结论时，由播放流程按解析来源与解码参数复验后写入
   * @param status - 请求与实际交付的对照结论
   */
  const setPlaybackQuality = (status: PlaybackQualityStatus): void => {
    if (!detail.value) return;
    detail.value = { ...detail.value, playbackQuality: status };
  };

  /** 重置歌词状态 */
  const resetLyricState = (): void => {
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricIndex.value = -1;
    lyricLoading.value = true;
    syncToMain();
  };

  /** 简繁转换竞态 token */
  let transformToken = 0;

  // 监听简繁转换设置变化并重新解析当前歌词
  watch(
    () => useSettingsStore().lyric.cjkTransform,
    () => {
      if (activeLyric.value && lyricContent.value) {
        setLyric(activeLyric.value, lyricContent.value);
      }
    },
  );

  /**
   * 原子写入歌词
   * @param source - 歌词源
   * @param input - 主歌词 + 可选翻译 / 音译；传 null 即清空
   */
  const setLyric = (source: LyricData, input: LyricInput | null): void => {
    let nextLines: LyricLine[] = [];
    let authors: string[] = [];
    const settings = useSettingsStore();
    if (source && input) {
      try {
        const result = parseLyric(
          {
            content: input.content,
            format: source.format,
            translation: input.translation,
            translationFormat: input.translationFormat,
            romaji: input.romaji,
            romajiFormat: input.romajiFormat,
          },
          {
            detectBackground: settings.lyric.detectBackgroundLyrics,
            preferredLang: settings.locale,
            cleanKangxi: true,
            extractMetadata: true,
          },
        );
        nextLines = applyLyricExclude(result.lines, track.value);
        normalizeLyricLines(nextLines);
        applyLyricLanguages(nextLines);
        authors = result.metadata.authors?.length
          ? result.metadata.authors
          : extractLyricAuthors(input.content, source.format);
      } catch (e) {
        console.error("[media] parse lyric failed:", e);
        nextLines = [];
      }
    }
    // 解析后无有效行视作无歌词
    const hasContent = nextLines.length > 0;
    activeLyric.value = hasContent ? source : null;
    lyricContent.value = hasContent ? input : null;
    parsedLyric.value = nextLines;
    lyricAuthors.value = hasContent && source && input ? authors : [];
    lyricIndex.value = -1;
    lyricLoading.value = false;
    syncToMain();

    // 应用 OpenCC 简繁转换
    const cjkMode = settings.lyric.cjkTransform;
    if (hasContent && cjkMode && cjkMode !== "none") {
      const token = ++transformToken;
      applyLyricCjkTransform(nextLines, cjkMode).then((transformed) => {
        if (token !== transformToken) return;
        parsedLyric.value = transformed;
        syncToMain();
      });
    }
  };

  /**
   * 根据播放时间更新歌词行索引
   * @param time - 播放时间
   */
  const updateLyricIndex = (time: number): void => {
    lyricIndex.value = findLyricIndex(parsedLyric.value, time, lyricIndex.value);
  };

  /** 清空所有状态 */
  const clear = (): void => {
    track.value = null;
    playbackContext.value = undefined;
    detail.value = null;
    activeLyric.value = null;
    lyricContent.value = null;
    parsedLyric.value = [];
    lyricAuthors.value = [];
    lyricLoading.value = false;
    lyricIndex.value = -1;
    syncToMain();
  };

  return {
    track,
    playbackContext,
    detail,
    activeLyric,
    lyricContent,
    lyricFormat,
    parsedLyric,
    lyricAuthors,
    lyricLoading,
    lyricIndex,
    setTrack,
    setPlaybackContext,
    enrichTrack,
    patchCover,
    setPlaybackQuality,
    resetLyricState,
    setLyric,
    updateLyricIndex,
    clear,
  };
});
