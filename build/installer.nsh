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
