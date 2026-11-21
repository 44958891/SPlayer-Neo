# 音质图形来源

当前 29 档标签统一使用 SPlayer Neo 自绘矢量线条：路径集中在 `src/utils/qualityArtwork.ts`，颜色集中在 `src/styles/quality.css`，通过 `QualityIcon.vue` / `QualityTag.vue` 在所有平台、菜单和列表中使用。同一音质类别共用图形和配色，名称与版本由现有本地化文字展示；实际判定仍按来源与规格证据进行。

下面的官方素材和早期重绘文件保留作历史参考，统一标签已不再加载这些位图或平台专用字形。平台原始图形属于各自权利人；下载的客户端未执行，仅静态提取资源。

| 目录     | 官方入口与客户端版本                                                                                   | 包内原始资源                                                                                                                                      | 处理                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `kugou/` | [酷狗 PC 官方下载](https://download.kugou.com/download/kugou_pc)，`kugou_20161_x64.exe`，20.1.61.28014 | NSIS 内 `KuGou.7z` → `kugou.skn`：`音质蝰蛇母带_52x14.svg`、`音质全景声_43x14.svg`、`音质HiRes_34x14.svg`、`音质SQ_18X12.svg`、`音质HQ_18X14.svg` | 保留原始 SVG，分别命名为 `master`、`spatial`、`hires`、`lossless`、`hq`；原始配色同时适用浅深色 |

`qqmusic/` 来自 [QQ 音乐官方下载页](https://y.qq.com/download/download.html) 引用的安卓 64 位包 [`QQMusic2005000982_64.apk`](https://dldir.y.qq.com/ecosfile_plink/music_clntupate/android/other/QQMusic2005000982_64.apk)：

- `master.webp`：`r/n/icon_minibar_top_tip_master_tape.webp`，原图文字”臻品母带”，无版本数字；确认的 4.0 与历史母带档位共用该原图，4.0 版本仅由实际档位回执确认
- `spatial.webp`：`r/n/icon_minibar_top_tip_galaxy.webp`，臻品全景声
- `premium-light.webp` / `premium-dark.webp`：`r/n/icon_super_vip_quality_excellent_title.webp` / `r/n/icon_super_vip_quality_vertical_excellent_title.webp`，臻品音质 2.0 深字/金字原图
- `hires.svg` / `lossless.svg` / `hq.svg`：**高清重绘版本**（2026-11-20），原始 PNG 图标分辨率过低（99x33 / 57x33），重新设计为矢量 SVG，参考 QQ 音乐官方视觉风格，采用渐变色（Hi-Res 蓝色、SQ 绿色、HQ 橙色）+ 装饰元素，保持原始宽高比

QQ 原始 WebP 留作参考。`master.svg` / `premium.svg` / `spatial.svg` 是 SPlayer Neo 自绘的透明底线条标识，分别使用磁带、菱形声波及空间轨道图形，并非官方原图。应用内联 SVG 跟随主题配色，中文或英文名称由已有本地化文案渲染，确认的版本数字与名称一起排版；图形不再内嵌文字、彩色底板或模糊效果。

该 APK 的包标识为 `2005000982`；未根据文件名推定未经解析确认的版本名称。基础档位（Hi-Res/SQ/HQ）采用上面记录的矢量重绘版。

`migu/` 来自 [咪咕官方下载页](https://h5.nf.migu.cn/app/v5/p/download-music/index.html) 引用的[应用宝官方发行页](https://a.app.qq.com/o/simple.jsp?pkgname=cmccwm.mobilemusic)，安卓 `cmccwm.mobilemusic` 8.9.6：

- `master.png`：客户端插件 `assets/chaos/lib_music-master.zip` 内 `res/drawable-xxhdpi-v4/ic_tone_text_32.png`，原图文字“至臻母带”
- `hq.png` / `lossless.png`：APK 内 `res/drawable-xxhdpi-v4/v8_icon_tone_hq.png` / `v8_icon_tone_sq.png`

没有将咪咕的 `24bit` 品牌图用于任何通用 Hi-Res 文件；位深本身不证明“至臻音质”档位。`32bit` 母带样式仅用于来源明确声明的咪咕母带，实际文件规格仍沿用独立校验。

`kuwo/` 来自[酷我官方 H5 下载页](https://oia.kuwo.cn/kplayer.html) 的[安卓正式安装包](https://shoujidown.kuwo.cn/star/mobile/kwplayer_ar_kuwoH5.apk)，`cn.kuwo.player` V12.1.2.0（2026-11-13 构建）：

- `master.png` / `premium.png` / `spatial.png`：资源表中的 `zp_hifi_master_type_title_middle` / `zp_hifi_zp2_title_middle` / `zp_hifi_panoramic_sound_title_middle`，分别显示“至臻母带”／“至臻2.0”／“至臻全景声”
- `hires-light.png` / `hires-dark.png`：`hires_icon_black` / `hires_icon_white`
- `lossless.png`：`quality_icon_lossless`

保留原始 PNG。母带使用明确的文字图形，没有把 `dsd_icon_*` 当成任意 PCM 母带的标识；杜比全景声和至臻全景声是不同资源，未混用。

已有根目录的 `standard.svg`、`hq.svg`、`sq.svg`、`hires.svg`、`spatial.svg`、`vivid.svg` 是此前接入的网易云字形，使用 `currentColor` 跟随主题。

以上是历史素材记录。现行统一图形按音质类别选择，来源不明或声明与实测冲突时使用实际通用类别，平台名称与版本仍由既有判定和文案提供，不以图形推定来源。
