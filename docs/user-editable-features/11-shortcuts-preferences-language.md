# 단축키, 개인 설정, 언어 MCP 연동 분석

## 포함 기능

- 편집 단축키 변경 및 초기화
- 고정 단축키 조회
- 사용자 기본 설정: 기본 여백, 기본 종횡비, 기본 내보내기 품질, 기본 내보내기 형식
- 사용자 글꼴 저장
- 언어 변경과 저장
- 저장되지 않는 임시 상태 분류

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| shortcut model | `src/lib/shortcuts.ts` | action 목록, 기본값, fixed shortcut, conflict check |
| shortcut context | `src/contexts/ShortcutsContext.tsx` | load/save IPC, dialog open state |
| shortcut dialog | `src/components/video-editor/ShortcutsConfigDialog.tsx` | capture, conflict, swap, reset, save |
| shortcut IPC | `electron/ipc/handlers.ts` | `shortcuts.json` read/write |
| user prefs | `src/lib/userPreferences.ts` | `localStorage` persistence |
| custom fonts | `src/lib/customFonts.ts` | `openscreen_custom_fonts` persistence |
| i18n | `src/contexts/I18nContext.tsx`, `src/i18n/config.ts` | locale state, system suggestion, main process sync |

## 단축키 모델

설정 가능한 action은 다음이다.

| 액션 | 기본 키 |
| --- | --- |
| `addZoom` | `Z` |
| `addTrim` | `T` |
| `addSpeed` | `S` |
| `addAnnotation` | `A` |
| `addBlur` | `B` |
| `addKeyframe` | `F` |
| `deleteSelected` | `Ctrl/Cmd + D` |
| `playPause` | `Space` |

고정 단축키는 실행 가능하지만 변경할 수 없다. 실행 취소/다시 실행, 주석 순환,
Delete/Backspace 삭제, 타임라인 pan/zoom, 프레임 이동이 여기에 속한다.

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.shortcuts.get` | resource | `ShortcutsContext.shortcuts`, `FIXED_SHORTCUTS` | platform label 포함 |
| `openscreen.shortcuts.setBinding` | tool | `findConflict` 후 `setShortcuts` + `persistShortcuts` | fixed 충돌 거부 |
| `openscreen.shortcuts.swapBinding` | tool | conflict 대상과 binding 교환 | dialog의 swap 동작 |
| `openscreen.shortcuts.reset` | tool | `DEFAULT_SHORTCUTS` 저장 | dialog draft 없이 즉시 적용 가능 |
| `openscreen.preferences.get` | resource | `loadUserPreferences` | localStorage |
| `openscreen.preferences.set` | tool | `saveUserPreferences` + renderer state update | editor state와 동기화 필요 |
| `openscreen.locale.get` | resource | current locale, supported locales | system suggestion 포함 가능 |
| `openscreen.locale.set` | tool | `I18nProvider.setLocale` | main process `setLocale` IPC 호출 |
| `openscreen.customFonts.*` | resource/tool | `customFonts.ts` | annotation 문서와 공유 |

## MCP 상호 작용 설계

단축키는 Electron main process의
`app.getPath("userData")/shortcuts.json`에 저장된다. renderer는 mount 시
`electronAPI.getShortcuts()`를 읽고 `mergeWithDefaults`로 누락 action을 채운다.
MCP tool이 단축키를 바꾸려면 `findConflict`로 fixed shortcut 충돌을 먼저 거부하고,
configurable action끼리 충돌하면 UI와 같이 swap을 제안하거나 명시적
`swapBinding`을 요구해야 한다.

`ShortcutBinding.ctrl`은 macOS에서는 Cmd, Windows/Linux에서는 Ctrl로 해석된다.
MCP schema의 modifier 이름은 platform-independent하게 `primary` 또는 현재 코드와
같은 `ctrl`을 쓰되, 응답에는 `isMac`과 사람이 읽는 `formatBinding` 값을 포함하는
것이 좋다.

사용자 기본 설정은 `localStorage`의 `openscreen_user_preferences`에 저장된다.
`VideoEditor`는 mount 후 preferences를 읽어 `padding`, `aspectRatio`,
`exportQuality`, `exportFormat`을 현재 editor state에 반영하고, 이후 이 값들이
바뀌면 자동 저장한다. MCP가 preferences만 파일처럼 바꾸면 이미 열린 editor state와
불일치할 수 있으므로, tool은 localStorage 저장과 renderer state update를 함께
수행해야 한다.

언어는 `I18nProvider.setLocale`이 source of truth이다. 이 함수는 localStorage의
`openscreen-locale`을 갱신하고 `document.documentElement.lang`을 바꾸며
`electronAPI.setLocale`로 main process에도 전달한다. MCP locale tool은
`SUPPORTED_LOCALES` 값만 허용하고, main process만 갱신하는 방식은 피해야 한다.

사용자 글꼴은 annotation 문서의 custom font 도구와 같은 저장소를 쓴다. 글꼴 목록
자체는 project에 저장되지 않고, 각 annotation의 `style.fontFamily`만 project에
저장된다.

## 저장되지 않는 임시 상태

| 임시 상태 | 소유 위치 | MCP 노출 방식 |
| --- | --- | --- |
| 현재 재생 시간 | `VideoEditor.currentTime`, video element | session resource/tool |
| 재생/일시정지 | `VideoEditor.isPlaying` | session resource/tool |
| 전체화면 상태 | `VideoEditor.isFullscreen` | session resource/tool |
| 타임라인 보기 범위 | `TimelineEditor.range` | session resource |
| 선택된 항목 ID | `selectedZoomId` 등 | session resource/tool |
| 키프레임 | `TimelineEditor.keyframes` | 임시 marker resource/tool |
| 업로드 배경 이미지 목록 | `SettingsPanel.customImages` | panel session state, project 미저장 |

## 제약과 검증

- shortcut binding은 modifier-only key를 허용하지 않는다.
- fixed shortcut과 충돌하면 거부한다.
- configurable shortcut끼리 충돌하면 자동 overwrite하지 않고 swap 또는 취소로
  처리한다.
- preferences의 padding은 `0..100`, aspect ratio/export quality/export format은
  허용값만 저장한다.
- locale은 `en`, `es`, `fr`, `tr`, `ko-KR`, `ja-JP`, `zh-CN`, `zh-TW`만 허용한다.
- localStorage 기반 설정은 열린 renderer state와 같이 갱신해야 한다.
