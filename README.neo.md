# SPlayer Neo（苏木定制版）

> 基于 [SPlayer-Next](https://github.com/SPlayer-Dev/SPlayer-Next) 的**个人定制分支**，遵循上游的 **AGPL-3.0** 协议开源。
>
> 本仓库不是 SPlayer-Next 官方仓库，与 SPlayer-Dev 团队无隶属关系。上游代码版权归原作者 [imsyy](https://github.com/imsyy) 及 SPlayer-Next 贡献者所有；本仓库仅包含定制改动。

## 这是什么

SPlayer Neo 是 SPlayer-Next 的定制发行版，保留上游全部能力，并叠加了一批自用改进。安装包命名、关于页与欢迎语显示为「SPlayer Neo」，但为了兼容已有安装，程序内部标识（appId / 安装目录 / 用户数据目录）仍沿用 `SPlayer-Next`，**覆盖安装不会丢失配置、歌单与缓存**。

## 相对上游的改动

**音源**

- 新增**咪咕音乐（MG）**音源：搜索单曲/专辑/歌手、专辑详情（含数字专辑双通道）、歌词（OSS LRC 直取）、走插件 `mg` 源取链
- 新增**酷我（KW）**完整接入：搜索、专辑、歌手、歌单、歌词、官方取链、网页登录
- 音源体检：逐插件 × 逐档位实际取链探测，失效组合持久化记忆，播放时自动避让
- 下载链路预探针：1 字节 Range 探测拦截试听片段/防盗链/无效数据
- 手动换源：右键「切换播放源」，四平台并行搜索后择优

**播放**

- 随机播放重构：**播放列表顺序永不被打乱**，随机只决定下一首跳转；一轮内不重复、播完自动开新轮；「上一首」沿播放历史精确回退
- 「播放全部」严格跟随列表当前排序（标题/歌手/专辑/时长/大小/时间/曲目号 + 正倒序），覆盖音乐库、我喜欢、历史、歌手、云盘、文件夹、集合共 7 处
- 交叉过渡预载与随机目标共用同一决策，不会预载错歌

**曲库与歌单**

- 歌单链接导入：网易云（含 163cn.tv 短链）、QQ音乐、酷狗、酷我批量导入，逐行状态提示
- 歌单备份：全量 JSON 导出/导入 + 单歌单 m3u8 导出
- 音质升级：多平台匹配同名更高音质版本，下载后校验并替换原文件
- 封面与歌词补全：只补缺失项，不覆盖已有标签
- 在线曲目标注「本地已有」，避免重复下载

**界面**

- 全站小标签尺寸对齐（音质 / VIP / EP / 本地已有 / 升级标记统一 18px 基线）
- 深色/浅色主题下标签配色区分，亮色主题单独适配

**工程**

- **i18n 守卫**：`src/i18n/locales.spec.ts` 静态扫描全仓 `t("…")` 与 `labelKey` 声明，缺键、中英键集合不一致、模板键前缀无效都会让测试与打包失败
- 补齐 78 个历史缺失的多语言条目

## 与上游同步

```bash
git remote add upstream https://github.com/SPlayer-Dev/SPlayer-Next.git
git fetch upstream
git merge upstream/dev      # 或 git rebase upstream/dev
```

冲突高发区：`shared/types/platform.ts`（平台枚举）、`src/services/audioSource.ts`（取链编排）、`src/i18n/locales/*.json`（文案）。

## 版本号规则

正式版之间用 beta 累积，攒够一轮改动后再提升为下一个正式版（例如 `1.1.0-beta.1` … `1.1.0-beta.10` → `1.1.0`）。

```bash
pnpm version:beta         # 1.0.0 → 1.1.0-beta.1；1.1.0-beta.1 → 1.1.0-beta.2
pnpm version:beta:patch   # 1.0.0 → 1.0.1-beta.1（只修 bug、不加新功能的补丁线）
pnpm version:promote      # 1.1.0-beta.10 → 1.1.0（发正式版）
```

脚本只改 `package.json` 的 `version`，不写 CHANGELOG。发版流程：

1. `pnpm version:beta`（或 `version:promote`）
2. 在 `CHANGELOG.md` 顶部补一条对应版本的更新记录
3. `pnpm test && pnpm build:win`
4. 提交并打 tag（`v<版本号>`），在 GitHub 发布 Release，上传 `SPlayerNeo-<版本>-x64-setup.exe`、同名 `.blockmap`，以及对应的更新描述文件：
   - beta 版本上传 `beta.yml`
   - 正式版上传 `latest.yml`

> 更新描述文件与 `.blockmap` 必须一起上传，否则客户端「检查更新」会 404 或校验失败。beta 版本要同时勾选 Release 的「预发布（pre-release）」，否则正式版用户会被提示升级到 beta。

## 构建

```bash
pnpm install
pnpm dev            # 开发
pnpm build:win      # 打包 Windows 安装包
```

产物：`dist/SPlayerNeo-<版本>-x64-setup.exe`

## 协议

[AGPL-3.0](./LICENSE)。本仓库为上游的衍生作品，同样以 AGPL-3.0 发布；再分发时请保留原作者版权声明与协议文本。
