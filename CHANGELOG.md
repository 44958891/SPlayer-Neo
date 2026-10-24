# SPlayer-Next 定制版更新日志

本仓库是 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 的本地定制分支（AGPL-3.0），记录从 1.1.0 起的所有功能新增与修复。

- 安装包目录：`D:\Download\SPlayer-Next-Mod\`
- 源码工作区：`D:\BaiduNetdiskDownload\zcode\SPlayer-Next`
- 当前最新：**1.2.0-beta.35**（2026-10-23）

> 说明：每个版本的"新增/修复"条目均按当期 asar 产物内的特征标记核验过（见文末核验方法），不是仅凭记录推断。

---

## 1.2.0-beta.35（2026-10-23）— 全站小标签尺寸复查

**修复**

- 下载管理：曲目行「升级」标签原来是 `px-1.5 py-0.5` 胶囊 + 12% 主色底，与音乐库的「本地已有」视觉不统一；改为同款 18px 描边标签（`ring-primary/35`）。同页 `QualityTag` 的 `mt-[3px]` 也改为固定 `h-[18px]`
- 全屏播放器：元信息行 LOCAL / Master / LRC 三个标签高度原来分别是 23.2 / 23.2 / 23.2，但内部 QualityTag 只有 21.6px 导致图标略偏上；统一为固定 `h-[22px] + items-center`，三枚标签顶边与高度完全一致
- 复查后确认无需改动的：插件列表/音源体检的 `STag`（已有固定 h-4/h-5 预设）、统计页热力图提示（独立浮层，不与标签共行）、导航栏会员角标（独立胶囊）

**验证**

- 播放器三枚标签实测 h=22.0，顶边同为 y=104；音乐库三枚 h=18.0，顶边 y=252.6
- typecheck 0 错，node 43/43 + web 316/316

---

## 1.2.0-beta.34（2026-10-22）— 统一曲目标签尺寸

**修复**

- 「本地已有」「VIP」「EP」「音质」四个标签高矮不一：VIP/EP 用 `leading-[18px]` + 1px 边框，渲染出来 19.6px；本地已有 18px；音质图标只有 12px，靠 `mt-[3px]` 硬凑，整体基线参差
- 统一为固定 `18px` 行高 + `inline-flex items-center` 垂直居中：VIP/EP 改 `h-[18px] border`（不再靠 line-height 撑高），本地已有改 `h-[18px]`，音质标签外层也定 `18px` 并去掉临时 `mt-[3px]`
- 实测三个标签的盒子高均为 18.0px、顶边同为 y=252.6，文字与图标在同一条中线上

---

## 1.2.0-beta.33（2026-10-22）— 在线曲目标注「本地已有」

**新增**

- 在线歌单/搜索结果/歌手页/每日推荐/我的云盘里，本地音乐库已存在的同一首歌会在音质标签前显示「本地已有」徽标，避免重复下载
- 徽标样式：无底色、浅蓝文字 + 细描边，与音质、VIP 标签同一行基线对齐
- 判定规则与音质升级一致：标题忽略大小写/空白/括号 + 歌手有交集 + 时长 ±5s；任一侧缺歌手或时长时放宽为按标题判断
- 本地曲目按归一化标题建索引（桶 + 命中即返回），2050 首的库在搜索页渲染无明显开销
- 首次打开在线列表时若本地库尚未加载，自动触发一次 `library.load()`，无需先进音乐库

**验证**

- 搜索「周杰伦」18 条结果中 16 条正确标注（本地库确有这些曲目），未命中的两条为新歌
- 徽标文字 10px、高 18px，与 Hi-Res / VIP 标签同基线
- 单测 `src/utils/localMatch.spec.ts` 6 条（括号归一、歌手无交集、时长窗口、缺字段放宽、多歌手、Live 版同桶）

---

## 1.2.0-beta.32（2026-10-22）— 播放全部跟随列表排序

**修复**

- 音乐库改过排序方式（按标题/歌手/专辑/时长/大小/修改时间…）后点「播放全部」，队列仍是曲库默认顺序，播放列的排序与界面不一致
- 根因：各页面「播放全部」直接把原始 `tracks` 交给 `playFrom`，而排序只发生在 `SongList` 内部（`sortedItems`），两者各算一套
- 抽出 `src/utils/trackSort.ts`：排序规则与列表列排序逐条对齐（含同值先按标题、再按 id 兜底，保证稳定），`SongList` 改为复用同一函数，不再有第二份比较逻辑
- 顺带修掉同一问题影响的所有列表页：音乐库、我喜欢的音乐、播放历史、歌手页、我的云盘、文件夹视图、专辑/歌单集合页（共 7 处「播放全部」）

**验证**

- 按标题正序：列表首项「阿刁」→ 点播放全部，队列首曲「阿刁」，播放列表面板顺序与列表一致
- 切倒序：列表首项「Try」→ 播放全部后首曲「Try」，队列依次 Six Degrees → Mojito → Mine Mine → I Do
- 单测 `src/utils/trackSort.spec.ts` 5 条（默认顺序不动入参、标题自然序、六种字段、同值兜底、曲目编号）

---

## 1.2.0-beta.31（2026-10-22）— 新增咪咕音乐音源

**新增**

- 搜索页平台切换新增 **MG（咪咕）**：与 NCM/QM/KG/KW 并列，支持单曲、专辑、歌手三类结果；歌单接口咪咕已下线，该 tab 显示空结果而不是报错
- 咪咕曲目取链走插件 `mg` 源（EM 等插件已支持），自动透传 `copyrightId`（宿主存在 `Track.extId`），插件取链命中率与官方搜索一致
- 专辑详情页：普通专辑与**数字专辑**双通道（搜索只给一个 id，先查 `resource/album`，空则回退 `resource/dalbum`），《最伟大的作品》这类数字专辑现在能正常列出 12 首
- 咪咕歌词：走搜索 → `lyricUrl` 直取 OSS 上的 UTF-8 LRC（无按 id 接口，`matchById` 恒为 null，宿主对该平台强制走 query 路径）
- 混流补充：换源对话框、音质升级/封面补全的音源下拉、歌单导入的平台归属、插件元数据/评论的源映射都已带上 migu

**修复**

- 咪咕搜索结果的 `songAliasName` 是英文别名（"Sunny Day"），先前误用作标题；改用 `name` 作标题，别名仅兜底
- 专辑歌曲接口返回的 `img1/img2/img3` 是站内相对路径，未补 CDN 前缀导致封面空白，现统一补 `https://d.musicapp.migu.cn`
- 咪咕歌手搜索结果没有头像与歌手页接口，点击不再跳到空页面

**已知限制**

- 咪咕没有歌手详情/歌手歌曲接口，歌手页不提供
- 咪咕歌单（搜索、详情、导入）接口均已下线，全部不提供
- 咪咕网页版无稳定的单曲分享路由，分享按钮对 migu 返回空

---

## 1.2.0-beta.30（2026-10-21）— 修复两个弹窗显示英文 i18n key

**修复**

- 「音质升级」「封面与歌词补全」两个弹窗整块显示成 `library.upgrade.title`、`library.backfill.description` 这类原始 key：对话框组件新增时漏了 `zh-CN` / `en-US` 的文案条目，vue-i18n 缺键时直接回显 key
- 一并补齐同类缺失的 78 个键：`library.upgrade.*`（24）、`library.backfill.*`（31）、`settings.plugins.check.*`（18，「音源体检」弹窗与插件列表入口）、`settings.songLevel.{jyeffect,sky,jymaster}`（音质切换里的环绕声/空间音频/母带）、`download.{alreadyLocal,upgradeTag}`、`song.unknownArtist`
- 顺带修正音质下拉里这三档的显示：此前同样是 key 直出，现在是「环绕声 (JYEffect) / 空间音频 (Sky) / 母带 (Master)」

**防回归**

- 新增 `src/i18n/locales.spec.ts`：静态扫描 `t("…")`/`$t("…")`/`labelKey|titleKey|descKey|placeholderKey`，校验①中文缺键②英文缺键③中英键集合一致④模板字符串键的静态前缀是存在的命名空间；缺键直接失败并给出「键 ← 首个引用位置」
- `pnpm test:i18n` 单独跑，`pnpm test` 与 CI 自动跑；`pnpm build` 增加该守卫，缺键时打包直接中止
- `AGENTS.md` 与 `docs/contributing.md`、`docs/en/contributing.md` 写入硬性要求与排查流程
- 已做负向验证：删掉 `library.upgrade.*`（中）/ `library.backfill.optCover`（英）后守卫立即失败并报出具体键，恢复后通过

**校验方式**

- 扫全仓 `t("…")` 与 `labelKey/titleKey` 共 1030 个键，中英两套 missing = 0
- 实测：音乐库 → 音质升级弹窗（Master / 全部平台 / 开始检测 / 提示段落 / 取消 / 升级所选）与 封面与歌词补全弹窗（补封面 / 补歌词 / 开始扫描 / 取消 / 写入所选）全部中文正常
- typecheck 0 错，单测 node 43/43 + web 296/296

---

## 1.2.0-beta.29（2026-10-21）— 随机播放重构：列表顺序不动，只随机走向

**重构**

- 随机播放不再物理打乱播放列表：队列严格保持原始顺序，随机只决定「下一首跳到哪」
- 播放列表面板（右下角气泡/全屏播放列表）在随机模式下显示的顺序 = 列表原始顺序，当前曲高亮跟随
- 一轮内不重复：随机在「未播过」的曲目中挑选，整轮播完自动开新一轮；跳过关键词命中的曲目在随机下也被真正跳过（旧逻辑 nextTrack 从不跳过，只有预载候选跳过）
- 随机下的「上一首」沿播放历史回退（能精确回到上一首听过的歌）；队列增删/拖动会使历史失效并重新挑选
- 预载与交叉过渡在随机模式下与真正切歌共用同一个预定目标（`shuffleNextIndex`），不会预载错歌
- 移除 `originalQueue` 备份/`shuffleQueue`/`unshuffleQueue` 整套物理洗牌机制（含持久化字段 `originalPlayList`，旧数据自动忽略）
- 新增 `src/core/player/shuffle.ts` 纯状态机 + 4 条单测

---

## 1.2.0-beta.28（2026-10-21）— 播放全部不再被随机打乱

**修复**

- 开着「随机播放」时点「播放全部」，队列会被立即洗牌（播放列表面板显示顺序 ≠ 搜索/列表顺序）。现在 `playFrom` 设置新队列时若随机开启，先切回「顺序播放」再入队，队列严格保持调用方给出的顺序（搜索结果、歌单、喜欢的音乐等所有「播放全部」入口一致）
- 切换时会弹「顺序播放」toast 提示；用户仍可手动再开随机（开启时会按原逻辑洗牌，当前曲置顶）

---

## 1.2.0-beta.27（2026-10-21）— 搜索页播放全部

**新增**

- 搜索结果页「单曲」tab 的标签行右侧新增「播放全部」按钮：一键把当前搜索结果作为播放队列，从第一首开始播放
- 按钮复用全站同款 `SButton`（primary/secondary/small/round），与标签行垂直居中对齐、右侧与平台切换组同一右边界（20px 内容内边距），不额外占一行
- 仅在「单曲」tab 且已有结果时显示，切到专辑/歌手/歌单或空结果时自动淡出
- 播放来源上下文写入 `search:<平台>:<关键词>`，队列来源显示为「搜索: 关键词」，播放列表回看能认出出处

**修复**

- 平台切换组 `w-40` 装 4 枚标签（NCM/QM/KG/KW）时最后一个被裁，改为 `w-64`

---

## 1.2.0-beta.26（2026-10-19）— 竞品对标：歌单迁移 + 备份 + 换源 + 下载并发

调研 YesPlayMusic / R3PLAY-X / LX Music / listen1 / FeelUOwn 后的落地项。

**新增：歌单迁移导入（P1）**

- 侧栏「我的歌单」标题旁新增导入按钮，粘贴平台歌单链接即可导入为本地歌单
- 支持网易云（含 163cn.tv 短链，经主进程跟随重定向解析）、QQ音乐、酷狗（specialid）、酷我；纯 ID 按弹窗内选定平台归属
- 逐行批量导入，单行失败不影响其余行；进度逐行显示（等待/进行/成功/失败+原因）
- 导入的在线曲目以快照存入新表 `external_tracks`，播放时按 source/id 走对应平台解析，无需下载
- 修复：`getPlaylist` 原 SQL 用 `INNER JOIN tracks`，导致在线曲目被过滤（导入后显示 100 首但列表为空 → 已去掉 JOIN，改为双表兜底查询）

**新增：歌单备份导出/导入（P1）**

- 设置 → 本地与缓存 → 「歌单备份」：全部歌单导出为 JSON（含在线曲目快照）、导入恢复（重名自动加「(导入)」后缀）
- 单个歌单可导出为 m3u8：本地曲目写绝对路径，在线曲目写 `#SPLAYER-NETEASE-TRACK:<id>` 占位注释并在提示中说明跳过数量
- 复用现有 `system:saveFile`（写入系统下载目录，重名自动加序号）

**新增：歌曲手动换源（P2）**

- 在线曲目右键菜单新增「切换播放源」：按「标题 + 歌手」在四个平台并行搜索，点选即切源播放
- 视觉与全局统一：搜索框改用 `SInput`（带搜索图标，与标签编辑器同款），结果行改为 `SImg` 封面 + 标题 / 歌手·专辑 + `STag` 标签 + 平台简写 + 时长，四平台结果合并为单一列表（不再按平台分节，避免与全局列表风格割裂）
- 标注「原曲」/「正在播放」；搜索单平台失败不影响其他平台

**新增：下载并发数设置（P2）**

- 设置 → 下载配置新增「同时下载数」（1~6，默认 1）
- `downloadManager` 的 `pump` 由单任务串行改为并发槽位：改设置后下一个任务即生效，取消/删除逻辑同步改为 `active` 集合判定

**确认已具备（无需改动）**

- 歌词翻译/罗马音：`resolve.ts` 已接入 `tlyric`/`rlyric`，渲染层支持

**验证（实机，CDP 量取 + 库表核对）**

- 导入网易云歌单「原创榜」（2884035）：100 首落库，列表可见，双击可播（实测播放条显示曲名/歌手/Master）
- 导出 JSON：96,868 字节，`playlists[0].tracks.length === 100`，首曲含完整 artists/album 字段
- 导入 JSON：生成「原创榜 (导入)」，100 首
- 导出 m3u8：7,941 字节，100 条 `#EXTINF` + 占位注释，提示「100 首在线曲目以占位注释写入」
- 换源弹窗：四平台并行搜索有结果，点选后播放条切换到目标曲目
- typecheck 双侧 0 诊断；单测 node 43/43、web 293/293

**验证方法备注**：SSelect（Reka UI）不响应合成 click，需用 CDP `Input.dispatchMouseEvent` 发真实指针序列（mouseMoved → mousePressed(buttons:1) → mouseReleased）；本机脚本 `D:\tmp\sp-ui\cdp.mjs` 已封装 mouse/key 动作。

**未执行**：QQ音乐/酷狗/酷我 三个平台的真实歌单导入测试（仅验证了解析规则与代码路径）；下载并发 > 1 的实测（只验证了默认 1 与类型/设置项生效）。

---

## 1.2.0-beta.25（2026-10-19）— 界面视觉细节修正

用 CDP 逐页量取几何尺寸 + 截图做像素级核对（首页/音乐库/下载/统计/喜欢的音乐/播放历史/全屏播放器/设置各页/插件页/补全与体检两个自研弹窗），宿主机 125% DPI（1610×1019 物理像素 / 1288×815 CSS）。

**修复（两处，均为量取证实的真实缺陷）**

1. **亮色主题下背景图遮罩方向错误（严重，文字几乎不可读）**
   - `AppBackground.vue` 的压暗层固定 `bg-black`，亮色主题下深色正文压在深色遮罩上：实测标题「音乐库」与背景对比度 **1.15:1**（WCAG AA 需 4.5:1），全屏背景图模式下整页文字发灰
   - 改为按 `theme.isDark` 切换 `bg-white`/`bg-black`，亮色下 opacity 至少 0.66（取 `max(dim, 0.66)`，避免用户把 dim 调到 0 时又失去对比度）
   - 修复后同区域局部对比度 **1.25 → 11.2**（深色文字 vs 提白背景）

2. **列表「大小」列被浮动按钮遮挡（音乐库/歌手页）**
   - `SongList.vue` 行与表头 `pr-6`（24px），「大小」列文字右缘 1242，浮动「回到顶部/定位歌曲」按钮左缘 1222 —— 实测文字横向 20px 压在按钮上（截图可见「113.3 …」被裁）
   - 改为 `showSize ? 'pr-14' : 'pr-6'`（56px / 24px），只在启用大小列时加宽，其他列表零变化
   - 修复后大小列右缘 1213，与按钮左缘 1222 之间有 **9px 空隙**

**审查通过（未发现问题）**

- 表头与单元格列对齐（专辑/操作/时长/大小 逐列量差 ≤1px）
- 全局设置弹窗水平居中（centerX 644 = 视口 1288/2）
- 自研「音源体检」「封面/歌词补全」弹窗居中、按钮排布、`620px` 与 SDialog 默认 `460px` 宽度差异属预期
- 播放条居中于内容区（322..1218，中心 770 = 内容区中心），非视口中心属设计（左侧有 252px 侧栏）
- 全屏播放器封面与歌词区不重叠；侧栏可滚动区（939 > 726）可正常滚动

**未执行**：英文界面文案下的视觉复核、多分辨率（1080p/2K）复测。

---

## 1.2.0-beta.24（2026-10-17）— 安装页可选桌面快捷方式

安装向导新增一页「快捷方式选项」，复选框「创建桌面快捷方式」，默认勾选。

**实现**

- `build/installer.nsh`：用 electron-builder 的 `customPageAfterChangeDir` 钩子在「选择目录」之后插入自定义页（`nsDialogs`），`customInit` 把状态默认置为勾选；复选框布局对齐「安装选项」页规范（`10u` 缩进与单选钮左对齐、`y=12u` 与 header 留间隙、`280u` 行宽，实测截图逐像素核对）
- `customInstall` 统一校正结果：勾选且快捷方式缺失则补建（覆盖更新安装时 `keepShortcuts` 不重建的情况；**应用内静默更新 `--updated` 除外**）；取消勾选则删除；`--no-desktop-shortcut` 命令行开关优先
- **审计修复**：补建分支最初未排除 `isUpdated`，会把用户在应用内自动更新前删掉的桌面快捷方式重新建回来（beta.23 行为是保持删除）。已加 `${IfNot} ${isUpdated}` 守卫——静默更新沿用 keepShortcuts 语义，交互安装才按页面勾选补建
- `electron-builder.config.ts`：`createDesktopShortcut: true` + `include: "build/installer.nsh"` + `installerLanguages: ["zh_CN","en_US"]`

**踩坑**

- electron-builder 用 `-WX`（警告即错误）编译 NSIS：卸载器那一趟（`BUILD_UNINSTALLER`）没有 `Page` 指令，页面函数会触发 6010，变量会触发 6001 → 页面函数与 `Var` 必须包在 `!ifndef BUILD_UNINSTALLER` 内
- 自定义 `LangString` 未覆盖安装器全部语言时触发 6040 → 安装器语言收敛为 zh_CN/en_US 两种
- `$newDesktopLink` 由 electron-builder 的 `setLinkVars` 计算，直接用即可，不要自己拼 `$DESKTOP` 路径
- 自定义页标题若沿用 electron-builder 自带的「安装选项」会造成两页同名，页面标题改为「快捷方式选项」

**验证**

- 静默安装（`/S`，默认勾选）：退出码 0，`SPlayer Next.lnk` 创建成功，注册表与 exe 版本均为 1.2.0-beta.24
- 静默删除后 `/S --updated`：桌面快捷方式**保持删除**（isUpdated 守卫生效）；快捷方式存在时 `/S --updated` 保持存在
- 交互安装取消勾选：安装完成、桌面无快捷方式（200ms 轮询全程 `exists=False`）
- 交互安装保持勾选：安装完成、快捷方式创建（轮询 `t=2.5s exists=True` 并保持）
- 注意：本机 DeskBox 会把桌面快捷方式收纳进 `C:\Users\44958\DeskBox\系统功能软件\`，自动化验证时需先退出 DeskBox，否则会误判「快捷方式消失」

---

## 1.2.0-beta.23（2026-10-17）— 补全功能与标签编辑器对齐

与已有的「编辑元数据」（TagEditorDialog）入口做了一次冲突排查。

**排查结论**

- **无冲突**：两个入口写的是不同字段、走同一套底层 IPC；标签编辑器是单曲手动编辑（含标题/艺术家/专辑等全字段），补全是批量只补缺失的封面/歌词
- **实测播放中写标签不会失败**：Windows 上引擎并不长期持有文件句柄，正在播放的文件可直接写入（实测写入 258ms，播放状态与进度不受影响）

**修复（发现的真实不一致）**

- 补全弹窗此前**裸调 `library.writeTags`**，绕过了 `player.saveTrackTags`。后者负责两件关键事：① 目标含当前播放曲时先停播释放句柄、写后重载并恢复进度；② 写入成功后同步 media store / 播放队列 / 曲库列表。裸调会让播放器状态与磁盘不一致（尤其封面变更后界面不刷新）。已改为走 `saveTrackTags`
- 同步修正：封面写入后列表封面不刷新（`saveTrackTags` 内的 `applyTrackUpdates` 会带上 `?v=mtime` 的新封面 URL）；写入完成后仍做一次增量扫描，用于重建封面缩略图缓存

**验证**：typecheck 双侧无诊断、单测 293（web）+ 43（node）全绿；解包 beta.23 产物确认补全弹窗已调用 `saveTrackTags(payload)`；真机跑完整补全流程（播放中）未打断播放。

---

## 1.2.0-beta.22（2026-10-17）— 本地音乐封面/歌词补全

音乐库页新增「**封面/歌词补全**」圆钮（音质升级旁），扫描曲库中缺内嵌封面或内嵌歌词的本地文件，联网匹配后写回文件标签。

**新增**

- 补全弹窗 `MetadataBackfillDialog`：可分别勾选「补封面」「补歌词」、选择音源（单平台 / 全部平台并发）、进度显示、随时停止、结果逐条可勾选后写入
- 主进程 `library:readTagsBatch`：批量读标签只回「是否有内嵌封面 / 内嵌歌词长度」两个字段，分批 8 路并行。实测 500 首 **222ms**（逐首 IPC 往返在几千首规模下不可忽略）
- 缺失判定 `src/utils/backfill.ts`：`pickBackfillNeeds` 判定缺什么、`buildBackfillEdit` **只组装确实缺失且在线确实拿到的字段**（引擎按 `undefined = 不修改` 处理，因此已有封面/歌词绝不会被覆盖）；读取失败的项跳过而不是误判为"缺"
- 平台限流抽成 `src/utils/platformGate.ts`（节奏门 + 连续失败阶梯冷却熔断），与音质升级弹窗共用同一套策略
- 匹配沿用 `rankUpgradeCandidates`（标题精确/去括号 + 艺术家全匹配/部分 + 时长门槛 + 版本词黑名单），避免把原版补成 Live 版封面

**设计取舍**

- **不重新下载音频**：只补元数据，无损且快（升级弹窗管音质，本功能管标签）
- **只补不覆盖**：这是与「音乐标签编辑器」互补的批量场景，任何已有内容都不动
- **关闭弹窗即停止**：与 beta.21 的体检弹窗同规则

**真机实测**

- 批量读 500 首：222ms，失败 1 首（跳过）
- 扫描全库（2185 首）后得出待补 **27 首**（全部缺歌词，无缺封面项）
- 首次全流程：匹配 27/27、写入 27/27；抽查 8 首回读文件确认歌词已内嵌（如《一生有你》943 字符、《不得不爱》1460 字符，均带时间轴）

---

## 1.2.0-beta.21（2026-10-15）— 音源体检审计修复

对 beta.20 做了一次完整解包审计（解出 `app.asar` 逐行比对产物，并用本地 HTTP 服务模拟 CDN 异常行为），发现 3 个缺陷 + 5 处可优化项，全部修复并逐条真机验证。

**修复**

1. **体检表 TTL 失效**（影响最大：随时间劣化）
   - 现象：过期记录在"全量读取"路径上不可见性检查缺失，被删曲目/过期结论会变成永久黑名单，直到手动"清空记录"
   - 根因：TTL 判断只在 `healthLookup(key)` 里实现，但取链编排读的是无参 `health()` → 走 `healthSnapshot()`（直接返回原始表）
   - 修法：新增 `readLive()`，全量快照与单点查询共用，读取时剪除过期项并落盘
   - 实测：13 小时前的 hard 记录在全量快照中由 `可见` 变为 `不可见`，有效记录不受影响

2. **探针误判可用链接为"试听片段"**
   - 现象：服务器返回 206 但**不带 `content-range`** 时，`content-length` 是分段长度（1 字节），被判成"文件仅 0.0 MB，疑似试听片段"→ 硬失败
   - 修法：`parseContentSize` 增加 status 参数，**206 且无 content-range 时返回"体积未知"**（0），调用方跳过体积反推而非判失败
   - 实测（本地三种服务器行为）：修复前 `206+仅content-length` ❌ 误判，修复后 ✅ 通过
   - 注：本机两个插件的 8 条真实链接均返回标准 `content-range`，此缺陷属依赖上游行为的隐患

3. **IPC 入参畸形时抛异常**
   - `probeUrl(undefined)` / `probeUrl({})` 抛 `TypeError`；`healthReport({key:'x'})` 缺 entry 时同样抛
   - 修法：探针做 URL/协议校验（返回结论对象），`healthReport` 校验 key 与 entry
   - 实测：全部返回结构化结论（"URL 为空" / "不支持的协议（ftp:）"），不再抛

**优化**

- **体检弹窗关闭时自动停止**：弹窗组件不销毁，此前点关闭后体检仍在后台跑完 18 点。实测关闭后状态立即 `stopped`
- **曲目键命名空间统一**：手动体检此前写 `kw:228908`（插件源 key），取链查 `kuwo:228908`（平台 key），两套记录各自积累、互不复用。`CheckSong` 增加 `platform` 字段 + `checkSongKey()`，实测写入键与查询键一致
- **探针实测体积回传下载**：`OnlineResolveResult` 增加 `sizeBytes`，下载源解析传给主进程作 `declaredSize`（`content-length` 缺失时兜底进度）；实测带出 `sizeBytes: 55397039`
- **体检表读取缓存**：取链编排从"每首歌拉一次全表"改为 **10s TTL 内存缓存 + 写入主动失效**，升级扫描几百首时省掉绝大部分 IPC 全表序列化
- **失败提示分流**：`resolveDownloadSource` 改为返回带 `errorCode` 的结果；探针拒绝 → "音源只有试听片段或无效内容，已跳过（原文件未动）"；无插件 → "没有可用的音源插件，请在设置中启用"

**验证**：单测 278（web）+ 43（node）全绿；typecheck 双侧无诊断；解包 beta.21 产物核验 12 项特征全部命中（`readLive` / `HEALTH_CACHE_TTL_MS` / `parseContentSize` 带 status / 探针校验 / `checkSongKey` / 两个新提示键 / `bestSize` / 弹窗关闭停止）。

**此轮暴露的通用教训**：同一份数据有两条读取路径时（单点 vs 全量），校验逻辑必须落在**共用底层**而不是其中一条路径上——否则功能看起来正常，缺陷却随时间悄悄劣化（这类问题单测很难发现，需要专门的边界验证）。

---

## 1.2.0-beta.20（2026-10-14）— 插件页手动音源体检

新增设置 → 插件管理 → 已安装 tab 的「**音源体检**」入口，对每个已启用插件的每个平台源、逐档位真实取链并探测。

**新增**

- 体检弹窗 `SourceHealthDialog`：进度显示、随时停止、清空体检记录；结果按插件分组，逐点显示「来源 / 档位 / 实测体积 / 平均码率 / 耗时」
- 逐点执行 `checkSourcePoint`（主进程）：取链（8s → 超时后 25s 重试一次）→ 1 字节 Range 探针 → 码率对照 → 写体检记录
- 共享层 `shared/utils/sourceCheck.ts`：测试曲 fixture、档位挑选、码率反推、档位虚报判定、结果汇总（17 项单测）
- 判定分级：`可用` / `档位虚报`（声明高但实测码率不足）/ `不可用` / `超时` / `不适用`

**真机实测结果（本机双插件）**：可用 17 点、档位虚报 1 点 —— ikun 的酷我 hi-res 通道声明支持 hi-res，实测只有 128kbps。

**修复**

- 体检弹窗首跑全部报 `An object could not be cloned.`：诊断发现入参直接传了来自 `ref` 数组的对象（Vue 响应式 Proxy），IPC 结构化克隆失败。已改为深拷贝后传参（这是本项目第三次踩同一坑，前两次见 beta.13 与 download 请求构造）

**注意**

- 测试曲是固定的（wy《起风了》、tx/kg/kw/mg《晴天》/《演员》），选曲原则是"两插件都能取到链"，否则体检全红无参考价值
- 档位挑选按音质真实高低排序，不按插件声明数组顺序（实测有插件把最低档写在数组末尾）

---

## 1.2.0-beta.19（2026-10-14）— 音源体检四项（下载链路加固）

借鉴另一款播放器「瓜子音乐」（GZ Music，Electron 2.1.8）的音源检测机制，在下载/升级链路加入四层防护。其做法：对每个插件×平台×档位发 `Range: bytes=0-0` 探针、按体积反推时长、失败分 hard（记下跳过）/ soft（重试），匹配用版本词黑名单 + 分层打分。

**新增**

- **URL 预探针**：取链后对直链发 `Range: bytes=0-0`（只读 1 字节即断开），按 HTTP 状态 + Content-Type + 完整体积（content-range 总长）判定；体积低于 `歌曲秒数 × 8000 字节`（约 64kbps 地板）判为试听片段 / 防盗链语音，直接拒绝并报 `SOURCE_PROBE_REJECTED`
- **超时 soft-fail + 长超时重试**：取链首次 8s，超时后带 25s 重试一次；超时类错误不写体检记录（下次照常尝试）
- **匹配黑名单 + 分层打分**：本地曲名不含版本词时，候选带 `live/cover/remix/伴奏/现场/翻唱` 等版本词直接排除（这是此前"原版被换成 Live 版"的根治）；打分从二值判定改为 4 档（标题精确+艺术家全匹配 3.0 > 去括号匹配 2.0 > 精确+部分匹配 1.5 > 去括号+部分 1.4），同分按时长差
- **体检登记表**：落盘 `{app-data}/plugins/health.json`，成功结论保 24h（可复用实测体积）、硬失败保 12h（取链时跳过该组合）；键含插件脚本 hash（更新后自动失效）与曲目维度（避免"某首歌无版权"被误记为"插件整体不可用"）
- 插件卸载/更新时自动清理对应体检记录

**涉及的共享模块**

- `shared/utils/audioProbe.ts`（14 项单测）、`electron/main/plugins/probe.ts`、`electron/main/plugins/health.ts`
- `src/utils/qualityUpgrade.ts` 重写（17 项单测）

**设计取舍**

- 缺 Content-Type 且 URL 无音频后缀时判"软失败"而非硬失败 —— 本机插件走的是未配 MIME 的 CDN，照搬瓜子会误杀可用链接
- 保留了下载落地后的二次校验（beta.16 引入），探针是**前置补充**而非替代

---

## 1.2.0-beta.18（2026-10-14）— 下载只走插件 + 多插件并行取最优

**新增**

- `resolveByPluginBest`：并发调用全部可用音源插件解析 URL（`Promise.all`），按声明档位取最高版本；实测并行 137ms（对比串行 155ms / 292ms，不叠加）
- 播放链路的插件兜底同样改为并行取最优

**移除**

- "模拟播放下载"设置项及 `usePlaybackForDownload` 全链路（走官方接口的旧通道，是 beta.16 事故根源）

**背景**：官方通道存在静默降档（酷我 antiserver 忽略无损参数只给 128k）与密文数据（返回加密流导致文件不可解析），插件通道是酷我无损的唯一可靠来源。

---

## 1.2.0-beta.17（2026-10-14）— 替换下限显式化

**修复**

- `DownloadRequest.minLevel`：音质升级替换的显式质量下限。原文件已损坏（探测不出档位）时用它强制要求目标档位，避免"下限取不到、放行任意文件"

---

## 1.2.0-beta.16（2026-10-14）— 下载前置校验（重大事故修复）

**背景事故**：beta.14 的四平台并发升级在真机全选运行时，下载走"官方接口优先"链路，而酷我 antiserver 官方通道对无损参数恒拒答或静默给 128k mp3，部分歌返回加密/垃圾数据；下载器当时"先落盘覆盖再探测"，导致 578 个任务里 **93 首真损坏 + 72 首被降级**（共 165 首受损，曲库从 2304 掉到 2211）。

**修复**

- `verifyDownloadCandidate`：下载先落临时位（带正确扩展名）→ 引擎解析「内容有效性」+「档位是否达下限」→ **通过才覆盖目标**，失败则删临时文件、原文件分毫不动
- 新增错误码 `DOWNLOAD_INVALID_FILE` / `DOWNLOAD_QUALITY_NOT_MET`（前端提示"已保留原文件"）
- 音质升级以其原文件探测档位为替换下限
- 新增 `shared/utils/quality.ts`（主进程侧档位判定，与渲染端同规则，8 项单测）

**数据修复**：多轮重下把 165 首里的 144 首恢复到原档位或更好；21 首因插件音源本身给不出原档位保持现状。最终校验：磁盘 2304 个音频文件全部可解析、零损坏。

**教训**：批量升级脚本点"升级"前必须先取消全选只勾目标行；下载链路永远不能"先覆盖再校验"。

---

## 1.2.0-beta.15（2026-10-13）— 酷我封面 / 平台按钮 / 酷我登录

**修复**

- 酷我搜索无封面：`search.kuwo.cn/r.s` 不带 `&vipver=MUSIC_9.1.1.2_W1` 时 `ALBUM/ALBUMID/web_albumpic_short` 全空；四类搜索（单曲/专辑/歌手/歌单）与详情全部补上该参数
- 搜索页平台切换容器 `w-40` → `w-64`（4 枚按钮 NCM/QM/KG/KW 溢出）

**新增**

- 酷我登录：主进程 `KUWO_CONFIG`（官方 `kuwo.cn/?login=open`，partition `persist:kuwo-login`，轮询 `userid` 非 0 即成功）+ 会话收集与 Cookie 注入；渲染端登录适配器（网页登录 + Cookie 登录，酷我无公开扫码接口）+ 设置页「KW 登录」卡片

**接口要点**

- 主站 `www.kuwo.cn/api/www/user/info` 未登录返回 `data:null`；wapi 域名返回 404
- 歌词 `m.kuwo.cn/newh5/singles/songinfoandlrc` **不带 Referer 才稳定**（带 Referer 高频 301），需重试

---

## 1.2.0-beta.14（2026-10-13）— 酷我音源全链路 + 四平台并发升级

**新增**

- 酷我（kuwo）完整接入：主进程 `electron/main/apis/kuwo/`（搜索/专辑/歌手/歌单/取链，带 2 分钟缓存）、渲染端 API 分发、歌词、音频源、下载源、收藏、分享链接全链路
- 升级检测改四平台并发（网易/QQ/酷狗/酷我）：每首歌对启用平台并发搜索，**竞速采用**（任一平台命中且声明音质达目标即立即采用）；每平台独立状态机（节奏门、连续失败阶梯冷却、熔断停用）

**接口要点**

- 酷我搜索返回**伪 JSON**（单引号、值内转义为 HTML 实体），字段大小写混用（搜索大写 `NAME/ARTIST/MUSICRID`，详情小写）
- `antiserver.kuwo.cn/anti.s` 对 flac 恒 `refuse request!`，mp3 的 `br=320kmp3` 参数被忽略（返回 128k）
- 歌单详情 `nplserver.kuwo.cn/pl.svc` 必须带 `vipver` 才返回 musiclist，标题字段是 `title`

**实测**：653 首候选全量扫描约 5 分钟（单平台网易因 405 风控全量需数十分钟且频繁熔断）。

---

## 1.2.0-beta.13（2026-10-13）— 修复"点击升级无反应"

**修复**

- 根因：弹窗把匹配到的 track（来自 `ref` 响应式数组，是 Vue Proxy）直接经 IPC 传给主进程，抛 `DataCloneError: An object could not be cloned`。修复：入队前深拷贝为纯对象，并加 try/catch + 失败 toast
- `useDownload.prepareRequest` 同样深拷贝（其他入口同样受益）

---

## 1.2.0-beta.12（2026-10-13）— 本地音乐音质升级

**新增**

- 音乐库页「音质升级」入口 + 升级弹窗：选目标档（无损 / Hi-Res / 母带）+ 音源 → 扫描本地低于目标档的曲目 → 多平台匹配 → 勾选入队
- 匹配规则抽成 `src/utils/qualityUpgrade.ts`（标题归一 + 歌手重合 + 时长 ±5s）
- 主进程 `DownloadRequest/DownloadTask` 新增 `targetDir`（落地到原文件目录）与 `replaceSourcePath`（全部成功后删原文件与其歌词附档，失败不动原文件）

**风控防护**（网易 cloudsearch 约 10~16 次连发即 405）：全局节奏门 + 单曲退避重试 + 连续失败阶梯冷却熔断 + 中止后续检

---

## 1.2.0-beta.11（2026-10-11）— 主题切换解锁 + 巨图降采样

**修复**

- 主题模式切换被锁：外观风格=自定义图片时原版强制 `isDark=true` 且禁用主题按钮。解锁三处（theme store / NavHeader / appearance 设置项）
- 外观设置卡顿 587ms：背景图 16672×9980（1.66 亿像素）+ blur + 毛玻璃。新增 `maybeDownscaleBackground`（>3200 宽自动降采样，OffscreenCanvas + 新 IPC 存 jpg，gif 跳过）→ longtask 降至 71ms

---

## 1.2.0-beta.10 / beta.9（2026-10-11）— 官方音质图标

- **beta.9**：从网易云官方安装包提取 32×32 官方音质字形（standard/hq/sq/hires/spatial_audio/vivid）存 `src/assets/quality/`；新建 `QualityTag.vue`，接入列表/下载列表/播放控制/全屏播放器四处
- **beta.10**：母带档改为与其他档位同形态（去掉金色渐变底，改 Disc3 黑胶图标 + 亮金文字）

---

## 1.2.0-beta.8（2026-10-11）— 音质标签全部按真实文件判定

**修复**

- 统一规则：下载完成后用引擎空字段写入回读探测真实 `codec/sampleRate/bits`，回填任务音质；启动时对历史完成任务一次性回填；播放徽标删除"流档位优先"层，全部按引擎探测判定
- 背景：所选档位会虚标（老歌选 Master 但插件降档，实际是 48k 文件）

---

## 1.2.0-beta.7（2026-10-11）— 下载页音质徽标

**修复**

- DownloadList 徽标从"搜索元数据探测"改为"任务自带所选档位"，与官方客户端一致
- （该方案后被 beta.8 推翻，改为按真实文件判定）

---

## 1.2.0-beta.6（2026-10-11）— 原版会员图标

**修复**

- 从网易云官方安装包（NSIS 解包，`orpheus.ntpk`）提取原版 `svip.svg`（40×16 金色黑胶纹 + SVIP 矢量字），替换 beta.5 的文字徽标（用户嫌丑）

---

## 1.2.0-beta.5（2026-10-11）— 会员徽标三态修正

**修复**

- 会员徽标三态：无会员不显示 / 普通会员 CVIP / 超级会员 SVIP。映射抽成 `src/utils/vip.ts` 的 `vipBadgeLabel(vipType)`（11/110→SVIP，10/100 及其他非 0→CVIP，0→null）+ 三态单测

---

## 1.2.0-beta.4（2026-10-11）— 会员徽标动态化

**修复**

- VIP 徽标原为写死 "CVIP" 的静态图；改为按账号 `vipType` 动态渲染（实测本机账号 `vipType=110` → SVIP）

---

## 1.2.0-beta.3（2026-10-11）— 本地母带徽标

**修复**

- `getQualityLevel` 增加 24bit 且采样率 ≥176400Hz → `jymaster`（原来封顶 hi-res，本地母带 flac 只显示 Hi-Res）
- `isLosslessQuality` 改用 `isLosslessLevel`（否则母带文件丢失无损图标）
- 酷狗官方请求档封顶 hi-res（酷狗 API 不收 jymaster/sky）

---

## 1.2.0-beta.2（2026-10-11）— 母带档修复

**修复**

- 插件母带档翻译：原 `jymaster→flac24bit` 导致插件只被要 hi-res；改为按插件声明的 `qualitys` 用候选链挑档，并把实际档位回传
- 官方降档优先插件：官方直链档位低于请求时先试插件，插件承诺更高才替换，否则保留官方直链兜底
- 播放控制快捷切换补 `jyeffect/sky/jymaster` 三档

---

## 1.2.0-beta.1 起（2026-10-08 ~ 10-11）— 基础定制

- **音质扩到 8 档**：新增 `jymaster`（超清母带）/ `sky`（沉浸环绕声）/ `jyeffect`（高清环绕声），贯通插件协议、官方接口映射、LX 插件桥、设置页、右键菜单
- **下载同名跳过**：入队时扫描下载目录同名音频（大小写不敏感、任意音频扩展名），命中提示"本地已存在"；设置项 `skipExistingLocal`
- **QQ 音乐搜索修复**：`DoSearchForQQMusicLite` 被风控拦截，改用 `DoSearchForQQMusicMobile` 且认证跟随登录态
- 会员徽标、官方音质图标、主题解锁等一系列 UI 定制（见上）

---

## 构建与验证

**重打包命令**（工具链需已装；GitHub 直连超时必须用镜像）：

```bash
export PATH="$HOME/.cargo/bin:$PATH"
export LIBCLANG_PATH="C:/Program Files/LLVM/bin"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
cd /d/BaiduNetdiskDownload/zcode/SPlayer-Next
pnpm install && pnpm build:win
```

**构建前必须 taskkill 全部 `SPlayer-Next.exe`**（否则 rimraf dist 会因文件被锁失败）。

**验证**：`pnpm typecheck`（node + web 两侧）+ `pnpm test:web`（vitest，293 项）+ `pnpm test:node`（node:test，43 项）。

**版本核验方法**（本文档各条目的依据）：从各版本 setup 安装包解出 `app.asar`，对产物做特征标记 grep，确认该版本是否含对应功能。例如 `verifyDownloadCandidate` 首次出现在 beta.16、`probeUrl` 首次出现在 beta.19、`usePlaybackForDownload` 在 beta.18 消失。

**审计方法**（beta.21 使用，可复用）：解包 → 只提取 `out/` 下自己的产物（跳过 node_modules，否则 `extractFile` 会命中同名文件）→ 对新增模块逐行比对产物实现 → 用本地 HTTP 服务模拟 CDN 异常行为（见下）验证边界。

```js
// 三种 CDN 行为，用于验证探针判定（本地起服务后让渲染层去探）
standard:   206 + content-range + content-length=1   // 真实 CDN 的标准响应
lengthOnly: 206 + content-length=1                   // 无 content-range：体积不可知
ignoreRange: 200 + content-length=全长                // 忽略 Range 的服务器
```

**已知构建坑**：

- `pnpm build` 的 `rimraf dist` 会被运行中的 win-unpacked 实例锁文件（EPERM unlink d3dcompiler_47.dll）
- `vue-tsc` 偶发无诊断静默 exit 1，单独重跑即过
- IPC 传参不能直接传 Vue 响应式对象（Proxy），必须先 `JSON.parse(JSON.stringify())`（已在项目中踩过三次）

---

## 上游同步

本分支基于上游 `dev` 分支。同步上游时注意保留以下本地改动（它们与上游逻辑有交叉）：

| 模块                                        | 本地改动                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/services/audioSource.ts`               | `resolveByPluginBest` 并行取最优 + 探针接入 + 超时重试 + 体检表缓存（`readHealthTable`）         |
| `src/services/download/source.ts`           | 下载只走插件（不走官方接口）+ 失败带 `errorCode`                                                 |
| `src/services/download/resolver.ts`         | 解析失败按错误码分流提示                                                                         |
| `electron/main/services/downloadManager.ts` | 落地前校验 `verifyDownloadCandidate` + `minLevel`                                                |
| `electron/main/plugins/`                    | `probe.ts` / `health.ts` / `sourceCheck.ts`（新增文件）；`registry.ts` 内加了 `healthClear` 调用 |
| `shared/utils/`                             | `quality.ts` / `audioProbe.ts` / `sourceCheck.ts`（新增文件）                                    |
| `src/utils/`                                | `backfill.ts` / `platformGate.ts`（新增文件）；`qualityUpgrade.ts` 重写                          |
| `electron/main/ipc/library.ts`              | `readTagsBatch` 批量读标签（新增 handler）                                                       |
| `src/pages/Library.vue`                     | 新增「封面/歌词补全」入口                                                                        |
| `src/utils/quality.ts`                      | 8 档位 + 母带判定（24bit & ≥176.4kHz）                                                           |
| `electron/main/apis/kuwo/`                  | 酷我平台全链路（新增目录）                                                                       |
| `electron/main/ipc/plugin.ts`               | 探针 / 体检表 / 手动体检三组 IPC（入参校验在 handler 里）                                        |

许可证：AGPL-3.0（与上游一致）。
