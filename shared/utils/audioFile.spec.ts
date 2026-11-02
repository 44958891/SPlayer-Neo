import { describe, expect, it } from "vitest";
import { SUPPORTED_AUDIO_EXTENSIONS, isAudioFile } from "./audioFile";

/** 原生扫描器白名单（native/audio-engine/src/scanner.rs 的 AUDIO_EXTENSIONS） */
const NATIVE_EXTENSIONS = [
  "mp3",
  "flac",
  "wav",
  "ogg",
  "oga",
  "aac",
  "m4a",
  "m4b",
  "wma",
  "opus",
  "ape",
  "alac",
  "dsf",
  "dff",
];

describe("音频扩展名白名单", () => {
  it("shared 与原生扫描器的白名单完全一致", () => {
    const shared = [...SUPPORTED_AUDIO_EXTENSIONS].map((ext) => ext.replace(/^\./, ""));
    expect(shared.sort()).toEqual([...NATIVE_EXTENSIONS].sort());
  });

  it("DSD / ALAC 等扩展名都被识别为音频", () => {
    for (const ext of ["dsf", "dff", "alac", "m4b", "oga"]) {
      expect(isAudioFile(`/music/a.${ext}`)).toBe(true);
    }
  });

  it("非音频文件被拒绝", () => {
    expect(isAudioFile("/music/a.txt")).toBe(false);
    expect(isAudioFile("/music/novel")).toBe(false);
  });
});
