import type { Configuration } from "electron-builder";
import { readFileSync } from "node:fs";
import { SUPPORTED_AUDIO_EXTENSIONS } from "./shared/utils/audioFile";

/** 音频后缀注册为文件关联 */
const fileAssociations = [...SUPPORTED_AUDIO_EXTENSIONS].map((extension) => {
  const ext = extension.slice(1);
  return {
    ext,
    description: `${ext.toUpperCase()} Audio File`,
    role: "Viewer" as const,
  };
});

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version as string;
const prereleaseChannel = /-(alpha|beta|nightly)(?:\.|$)/.exec(packageVersion)?.[1];
const inferredUpdateChannel = prereleaseChannel ?? "latest";
const updateChannel = process.env.UPDATE_CHANNEL ?? inferredUpdateChannel;

if (
  updateChannel !== "latest" &&
  updateChannel !== "beta" &&
  updateChannel !== "alpha" &&
  updateChannel !== "nightly"
) {
  throw new Error(`不支持的更新通道: ${updateChannel}`);
}
if (packageVersion.includes("-") && !prereleaseChannel) {
  throw new Error(`不支持的预发布版本格式: ${packageVersion}`);
}
if (updateChannel !== inferredUpdateChannel) {
  throw new Error(`版本 ${packageVersion} 与更新通道 ${updateChannel} 不匹配`);
}

const config: Configuration = {
  appId: "top.imsyy.splayer-next",
  productName: "SPlayer-Next",
  copyright: "Copyright © imsyy 2025 · SPlayer Neo fork (AGPL-3.0)",
  directories: { buildResources: "public" },
  fileAssociations,
  afterPack: "./scripts/after-pack.ts",
  compression: "maximum",
  generateUpdatesFilesForAllChannels: true,
  files: [
    "public/**",
    "out/**",
    "!**/.vscode/*",
    "!src/**",
    "!native/**",
    "!scripts/**",
    "!electron/**",
    "!shared/**",
    "!electron.vite.config.{js,ts,mjs,cjs}",
    "!electron-builder.config.{js,ts,mjs,cjs}",
    "!uno.config.{js,ts,mjs,cjs}",
    "!{.eslintcache,eslint.config.mjs,auto-eslint.mjs,.prettierignore,.prettierrc.yaml,dev-app-update.yml,CHANGELOG.md,README.md}",
    "!{components.d.ts,auto-imports.d.ts}",
    "!{.env,.env.*,.npmrc,pnpm-lock.yaml}",
    "!{tsconfig.json,tsconfig.node.json,tsconfig.web.json}",
    "!**/*.{d.ts,ts,map,md}",
    "!**/{CHANGELOG,README,readme}*",
    "!**/node_modules/better-sqlite3/{deps,src}/**",
  ],
  // 保留的语言
  electronLanguages: ["zh-CN", "en-US"],
  asarUnpack: ["public/**"],
  extraResources: [
    {
      from: "native/audio-engine",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/audio-capture",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "resources/afp",
      to: "afp",
      filter: ["afp.mjs", "afp.wasm.mjs"],
    },
    {
      from: "native/media-ctrl",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-lyric",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/taskbar-thumbnail",
      to: "native",
      filter: ["*.node"],
    },
    {
      from: "native/opencc",
      to: "native",
      filter: ["*.node"],
    },
  ],
  extraFiles: [
    {
      from: "LICENSE",
      to: "LICENSE",
    },
  ],
  win: {
    executableName: "SPlayer-Next",
    icon: "public/icons/logo.ico",
    artifactName: "SPlayerNeo-${version}-${arch}.${ext}",
    forceCodeSigning: false,
    // 仅构建安装版；portable 已按需求移除
    target: ["nsis"],
    protocols: [{ name: "Orpheus Protocol", schemes: ["orpheus"] }],
  },
  nsis: {
    oneClick: false,
    guid: "top.imsyy.splayer-next",
    installerIcon: "public/icons/favicon.ico",
    uninstallerIcon: "public/icons/favicon.ico",
    artifactName: "SPlayerNeo-${version}-${arch}-setup.${ext}",
    shortcutName: "SPlayer Next",
    uninstallDisplayName: "SPlayer Next",
    // 桌面快捷方式由自定义安装页（build/installer.nsh）询问；这里保留 FRESH_INSTALL 语义
    createDesktopShortcut: true,
    // 安装器只保留中英双语（与应用语言一致；自定义页面的 LangString 也只需这两种）
    installerLanguages: ["zh_CN", "en_US"],
    include: "build/installer.nsh",
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    license: "build/license.txt",
  },
  portable: {
    artifactName: "SPlayerNeo-${version}-${arch}-portable.${ext}",
  },
  mac: {
    executableName: "SPlayer-Next",
    icon: "public/icons/icon.icns",
    artifactName: "SPlayerNeo-${version}-${arch}.${ext}",
    identity: null,
    hardenedRuntime: false,
    notarize: false,
    darkModeSupport: true,
    category: "public.app-category.music",
    entitlementsInherit: "public/entitlements.mac.plist",
    extendInfo: {
      NSCameraUsageDescription: "Application requests access to the device's camera.",
      NSMicrophoneUsageDescription: "Application requests access to the device's microphone.",
      NSDocumentsFolderUsageDescription:
        "Application requests access to the user's Documents folder.",
      NSDownloadsFolderUsageDescription:
        "Application requests access to the user's Downloads folder.",
      CFBundleURLTypes: [{ CFBundleURLName: "Orpheus Protocol", CFBundleURLSchemes: ["orpheus"] }],
    },
    target: ["dmg", "zip"],
  },
  dmg: {
    artifactName: "SPlayerNeo-${version}-${arch}.${ext}",
  },
  linux: {
    executableName: "SPlayer-Next",
    icon: "public/icons/favicon-512x512.png",
    artifactName: "SPlayerNeo-${version}-${arch}.${ext}",
    maintainer: "imsyy.top",
    category: "Audio;Music;AudioVideo;",
    target: ["AppImage", "deb", "rpm", "tar.gz", "pacman"],
    syncDesktopName: true,
    desktop: { entry: { MimeType: "x-scheme-handler/orpheus;" } },
  },
  appImage: {
    artifactName: "SPlayerNeo-${version}-${arch}.${ext}",
  },
  pacman: {
    artifactName: "SPlayerNeo-${version}-${arch}.${ext}",
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libxss",
      "libxtst",
      "xdg-utils",
      "at-spi2-core",
      "libsecret",
    ],
  },
  npmRebuild: false,
  electronDownload: {
    mirror: "https://npmmirror.com/mirrors/electron/",
  },
  publish: {
    provider: "github",
    owner: "SPlayer-Dev",
    repo: "SPlayer-Next",
    channel: updateChannel,
  },
};

export default config;
