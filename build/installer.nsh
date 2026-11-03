; ---------------------------------------------------------------------------
; 自定义安装页面：是否创建桌面快捷方式
;
; electron-builder 默认只有「安装选项 / 目录 / 安装 / 完成」几页，桌面快捷方式由
; createDesktopShortcut 配置一刀切。这里插入一个附加页，让用户自己决定。
;
; 实现要点：
; 1. 页面插在「选择目录」之后、「开始安装」之前（customPageAfterChangeDir 钩子）
; 2. 默认勾选；静默安装（/S）不走页面，变量保持默认 → 行为与升级前一致
; 3. 安装结束时统一校正：勾选但快捷方式缺失则补建，取消勾选则删除；
;    应用内静默更新（--updated，isUpdated）例外——不补建，沿用 keepShortcuts
;    语义（用户更新前删掉的快捷方式保持删除）
; 4. 页面函数只在安装器里编译：卸载器那一趟（BUILD_UNINSTALLER）没有 Page 指令，
;    编译进来会触发 NSIS 6010（函数未被引用）警告，而 electron-builder 把警告当错误
; ---------------------------------------------------------------------------

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"

LangString DESKTOP_SHORTCUT_PAGE_TITLE 2052 "快捷方式选项"
LangString DESKTOP_SHORTCUT_PAGE_TITLE 1033 "Shortcut Options"
LangString DESKTOP_SHORTCUT_PAGE_SUBTITLE 2052 "选择是否在桌面创建快捷方式"
LangString DESKTOP_SHORTCUT_PAGE_SUBTITLE 1033 "Choose whether to create a desktop shortcut"
LangString DESKTOP_SHORTCUT_CHECKBOX 2052 "创建桌面快捷方式"
LangString DESKTOP_SHORTCUT_CHECKBOX 1033 "Create a desktop shortcut"

!ifndef BUILD_UNINSTALLER

  ; 变量只在安装器里用：卸载器那一趟声明会被 NSIS 报 6001（未引用变量）
  Var DesktopShortcutCheckbox
  Var DesktopShortcutChecked

  !macro customInit
    ; 默认勾选：静默安装或页面被跳过时保持「创建」，与升级前行为一致
    StrCpy $DesktopShortcutChecked ${BST_CHECKED}
  !macroend

  !macro customPageAfterChangeDir
    Page custom DesktopShortcutPageCreate DesktopShortcutPageLeave
    ; 本宏在 assistedInstaller.nsh 里紧跟 !insertmacro MUI_PAGE_INSTFILES 之前展开，
    ; 在这里定义 SHOW 钩子才能真正作用到「正在安装」那一页（MUI 各页按需取用后即 undef）
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW InstFilesShow
  !macroend

  Function DesktopShortcutPageCreate
    !insertmacro MUI_HEADER_TEXT "$(DESKTOP_SHORTCUT_PAGE_TITLE)" "$(DESKTOP_SHORTCUT_PAGE_SUBTITLE)"

    nsDialogs::Create 1018
    Pop $0
    ${If} $0 == error
      Abort
    ${EndIf}

    ; 10u/280u 对齐「安装选项」页单选钮的缩进与行宽；12u 给 header 留间隙
    ${NSD_CreateCheckbox} 10u 12u 280u 12u "$(DESKTOP_SHORTCUT_CHECKBOX)"
    Pop $DesktopShortcutCheckbox
    ${NSD_SetState} $DesktopShortcutCheckbox $DesktopShortcutChecked

    nsDialogs::Show
  FunctionEnd

  Function DesktopShortcutPageLeave
    ${NSD_GetState} $DesktopShortcutCheckbox $DesktopShortcutChecked
  FunctionEnd

!endif

!macro customInstall
  ; $newDesktopLink 由 electron-builder 的 setLinkVars 算好（与其内部路径一致）
  ; 命令行 --no-desktop-shortcut 优先：尊重 electron-builder 既有开关
  ${If} ${isNoDesktopShortcut}
    ${If} ${FileExists} "$newDesktopLink"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${EndIf}
  ${ElseIf} $DesktopShortcutChecked == ${BST_CHECKED}
    ; isUpdated（应用内静默自动更新）不补建：沿用 electron-builder 的 keepShortcuts
    ; 语义——用户更新前删掉的快捷方式保持删除，交互安装（无 --updated）才按勾选补建
    ${IfNot} ${isUpdated}
    ${AndIfNot} ${FileExists} "$newDesktopLink"
      CreateShortCut "$newDesktopLink" "$appExe" "" "$appExe" 0 "" "" "${APP_DESCRIPTION}"
      ClearErrors
      WinShell::SetLnkAUMI "$newDesktopLink" "${APP_ID}"
    ${EndIf}
  ${Else}
    ${If} ${FileExists} "$newDesktopLink"
      WinShell::UninstShortcut "$newDesktopLink"
      Delete "$newDesktopLink"
    ${EndIf}
  ${EndIf}
!macroend

; ---------------------------------------------------------------------------
; 「正在安装」页：加宽进度条、替换状态文案
;
; MUI 默认把进度条画在内容区左上角一小段，配合 common.nsh 的
; ShowInstDetails nevershow，整个安装过程只有一根细条在动，信息量太低。
; 这里在页面显示时把进度条拉到与「安装选项」页控件同宽（12u 左边距、273u 宽），
; 状态文字换成带应用名的版本，并把两者上移到内容区顶部。
;
; 控件 ID 取自 NSIS 内置 instfiles 页：1004 = 进度条，1006 = 状态文字。
; SWP_NOZORDER(0x4) | SWP_NOACTIVATE(0x10) = 0x14
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER

  LangString SP_INSTALLING 2052 "正在安装 SPlayer Neo，请稍候…"
  LangString SP_INSTALLING 1033 "Installing SPlayer Neo, please wait…"

  Function InstFilesShow
    Push $0

    GetDlgItem $0 $HWNDPARENT 1006
    ${If} $0 != 0
      SendMessage $0 ${WM_SETTEXT} 0 "STR:$(SP_INSTALLING)"
      System::Call 'user32::SetWindowPos(p r0, p 0, i 12, i 54, i 273, i 16, i 0x14)'
    ${EndIf}

    GetDlgItem $0 $HWNDPARENT 1004
    ${If} $0 != 0
      System::Call 'user32::SetWindowPos(p r0, p 0, i 12, i 76, i 273, i 10, i 0x14)'
    ${EndIf}

    Pop $0
  FunctionEnd

!endif

; ---------------------------------------------------------------------------
; 安装器窗口标题
;
; 标题默认是 「${PRODUCT_NAME} 安装」，而 PRODUCT_NAME 同时决定安装目录与
; userData 目录（%APPDATA%\SPlayer-Next），改了会打断老用户升级。所以保留
; 内部 productName 不变，只用 Caption 覆盖标题栏文字（不触发 6029 重定义告警）。
; 卸载器那一趟不编译：卸载器有自己的标题。
; ---------------------------------------------------------------------------
!ifndef BUILD_UNINSTALLER
  Caption "SPlayer Neo 安装"
!endif
