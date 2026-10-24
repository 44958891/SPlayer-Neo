# Contributing

Thank you for contributing to SPlayer-Next. This page covers the local environment and core conventions.

## Requirements

- **Node.js** >= 22.19.0
- **pnpm** >= 10
- **Rust toolchain** for [native modules](/en/native)

## Getting started

```bash
git clone https://github.com/SPlayer-Dev/SPlayer-Next.git
cd SPlayer-Next
pnpm install
pnpm dev

# Pass arguments to the application
pnpm dev -- [arguments]...
```

Set `SKIP_NATIVE_BUILD=true` to skip Rust compilation during renderer-only development.

## Building

```bash
pnpm build
pnpm build:win
pnpm build:mac
pnpm build:linux

# Build selected electron-builder targets
pnpm build:win nsis
pnpm build:mac dmg
pnpm build:linux tar.gz

# Build unpacked output for local testing
pnpm build:unpack
```

See [electron-builder targets](https://www.electron.build/docs/targets) for all package targets.

## Common scripts

```bash
pnpm typecheck
pnpm lint
pnpm format
pnpm build:native
pnpm build:native --dev
```

## Project structure

```text
electron/main/      Main process: windows, IPC, native modules, services
electron/preload/   contextBridge APIs exposed as window.api
src/                Vue 3 renderer application
windows/            Desktop lyric, Dynamic Island, and taskbar lyric windows
native/             Rust native modules built with NAPI-RS
shared/             Cross-process types and defaults
```

## Conventions

- Write code comments in Chinese. Use standard JSDoc for methods and comment only when the reason is not obvious.
- Follow Prettier: double quotes, semicolons, 100 columns, and trailing commas.
- Run `pnpm typecheck` and `pnpm lint` before submitting.
- Import native types from `@splayer/*`; do not edit generated `native/*/index.d.ts` files.
- Use Conventional Commits in the form `<type>: <Chinese summary>` and keep the title on one line.

## Application localization

The application uses [vue-i18n](https://vue-i18n.intlify.dev/). Locale files are stored in `src/i18n/locales/`.

### Required: add every new string to both locale files

`zh-CN.json` and `en-US.json` must contain exactly the same set of keys. When a key is missing, vue-i18n renders the **raw key** in the UI (a dialog title shows up as `library.upgrade.title`), and it only appears once that screen is opened — so the defect ships silently.

`src/i18n/locales.spec.ts` guards against this:

```bash
pnpm test:i18n   # this guard only
pnpm test        # full suite, also runs in CI
```

It does four things:

1. Scans every `t("…")` / `$t("…")` plus `labelKey` / `titleKey` / `descKey` / `placeholderKey` declaration under `src/ windows/ electron/ shared/`;
2. Fails when a key is missing from the Chinese locale, listing `key ← first reference`;
3. Fails when a key is missing from the English locale;
4. Fails when the two key sets differ, and checks that the static prefix of a template-literal key such as ``t(`player.repeatMode.${mode}`)`` resolves to a real namespace.

Workflow for a new screen: write the component → run `pnpm test:i18n` to list the missing keys → add them to both JSON files → run it again.

> Hand-editing JSON blocks easily leaves `,,` or a trailing comma before `}`. Insert keys through a script (read JSON, mutate, write back) or an editor with JSON validation, then run the test immediately.

### Visual Studio Code

Install [i18n Ally](https://marketplace.visualstudio.com/items?itemName=Lokalise.i18n-ally) and configure:

```json
{
  "i18n-ally.localesPaths": "./src/i18n/locales/"
}
```

### JetBrains IDEs

Install [Easy i18n](https://plugins.jetbrains.com/plugin/16316-easy-i18n), select the `VUE_I18N` preset, and use this path template:

```text
$PROJECT_DIR$/src/i18n/locales/{locale}.json
```

## Pull requests

1. Create a feature branch from `dev`.
2. Run formatting, type checking, and linting.
3. Open the PR against `dev` and clearly describe the motivation and changes.
