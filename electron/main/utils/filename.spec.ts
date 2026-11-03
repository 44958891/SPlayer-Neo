import { describe, expect, it } from "vitest";
import { extFromCodec, resolveExtension } from "./filename";

describe("extFromCodec", () => {
  it("无损编解码器映射到对应扩展名", () => {
    expect(extFromCodec("flac")).toBe(".flac");
    expect(extFromCodec("alac")).toBe(".m4a");
    expect(extFromCodec("ape")).toBe(".ape");
    expect(extFromCodec("wavpack")).toBe(".wv");
  });

  it("有损编解码器映射到对应扩展名", () => {
    expect(extFromCodec("mp3")).toBe(".mp3");
    expect(extFromCodec("aac")).toBe(".aac");
    expect(extFromCodec("vorbis")).toBe(".ogg");
    expect(extFromCodec("opus")).toBe(".opus");
  });

  it("PCM 家族统一落 wav", () => {
    expect(extFromCodec("pcm_s16le")).toBe(".wav");
    expect(extFromCodec("pcm_s24le")).toBe(".wav");
  });

  it("DSD 家族统一落 dsf", () => {
    expect(extFromCodec("dsd_lsbf")).toBe(".dsf");
    expect(extFromCodec("dsd_msbf_planar")).toBe(".dsf");
  });

  it("大小写与空白不敏感，无法识别时返回 null", () => {
    expect(extFromCodec("  FLAC ")).toBe(".flac");
    expect(extFromCodec("unknown")).toBeNull();
    expect(extFromCodec(undefined)).toBeNull();
    expect(extFromCodec("")).toBeNull();
  });
});

describe("resolveExtension", () => {
  it("声明格式优先于 Content-Type", () => {
    expect(resolveExtension("flac", "audio/mpeg", "https://x/a.mp3")).toBe(".flac");
  });

  it("无声明时退到 Content-Type，再退到 URL", () => {
    expect(resolveExtension(undefined, "audio/flac", "https://x/a.mp3")).toBe(".flac");
    expect(resolveExtension(undefined, null, "https://x/a.flac")).toBe(".flac");
    expect(resolveExtension(undefined, null, "https://x/a")).toBe(".mp3");
  });
});
