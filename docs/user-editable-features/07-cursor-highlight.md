# 커서 하이라이트 MCP 연동 분석

## 포함 기능

- 사용 여부 켜기/끄기
- 스타일: `dot`, `ring`
- 크기: `10px..36px`
- 색상: 3자리 또는 6자리 HEX
- 클릭 시에만 표시
- X/Y 오프셋: 각각 `-25%..25%`

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 설정 UI | `src/components/video-editor/SettingsPanel.tsx` | cursor highlight controls |
| 타입/기본값 | `src/components/video-editor/videoPlayback/cursorHighlight.ts` | config, draw, click emphasis |
| 프로젝트 normalize | `src/components/video-editor/projectPersistence.ts` | `normalizeCursorHighlight` |
| 커서 telemetry 저장 | `electron/ipc/handlers.ts` | cursor samples/clicks capture and `.cursor.json` |
| preview | `src/components/video-editor/VideoPlayback.tsx` | Pixi graphics로 cursor highlight |
| export | `src/lib/exporter/frameRenderer.ts` | canvas cursor highlight render |

## 저장 필드

`cursorHighlight`는 `ProjectEditorState`의 일부로 저장된다.

| 필드 | 의미 | 정규화 |
| --- | --- | --- |
| `enabled` | 표시 여부 | boolean |
| `style` | `dot` 또는 `ring` | 그 외 `ring` |
| `sizePx` | 크기 | `10..36` |
| `color` | HEX 색상 | `#RGB` 또는 `#RRGGBB` |
| `opacity` | alpha | `0..1` |
| `onlyOnClicks` | 클릭 순간만 표시 | boolean |
| `clickEmphasisDurationMs` | click fade duration | `>0` |
| `offsetXNorm`, `offsetYNorm` | normalized offset | project normalize는 `-1..1`, UI는 `-0.25..0.25` |

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.cursorTelemetry.get` | resource | `electronAPI.getCursorTelemetry(videoPath)` | samples/clicks 조회 |
| `openscreen.cursorHighlight.get` | resource | `editorState.cursorHighlight` + platform support | mac 여부 포함 |
| `openscreen.cursorHighlight.set` | tool | `pushState({ cursorHighlight })` | 전체 config normalize |
| `openscreen.cursorHighlight.patch` | tool | 기존 config merge 후 `pushState` | 일반 UI 제어 |
| `openscreen.cursorHighlight.requestClickPermission` | tool | `electronAPI.requestAccessibilityAccess` | macOS only |

## MCP 상호 작용 설계

커서 하이라이트는 녹화 중 수집된 cursor telemetry가 있어야 preview/export에
보인다. MCP tool이 `enabled: true`를 설정해도 `cursorTelemetry`가 비어 있으면
시각 결과는 없다. resource 응답에는 `hasCursorTelemetry`, `sampleCount`,
`clickCount`를 함께 제공해야 자동 줌 추천 및 click-only 설정의 동작 가능성을
판단할 수 있다.

`onlyOnClicks`는 macOS에서만 UI가 노출되고, 접근성 권한이 필요하다. `VideoEditor`
는 off-Mac에서 persisted value는 유지하되 renderer에 전달하는
`effectiveCursorHighlight`에서 `onlyOnClicks`를 false로 강제한다. MCP도 platform을
확인해 non-mac에서는 실제 렌더 결과가 false임을 응답해야 한다.

click-only를 켤 때는 `SettingsPanel`처럼 `requestAccessibilityAccess`를 먼저
호출한다. 이 IPC는 권한을 프로그램적으로 부여하지 못하고 system prompt/settings
유도만 가능하다. MCP tool은 권한 상태와 사용자 조치 필요 여부를 반환해야 한다.

오프셋은 창 녹화에서 cursor 좌표 보정을 위한 값이다. UI는 `-0.25..0.25` 범위만
노출하지만 project normalize는 더 넓은 `-1..1`을 허용한다. MCP는 UI와 일관되게
기본 범위를 `-0.25..0.25`로 제한하고, advanced option에서만 확장 범위를 허용하는
편이 안전하다.

## 제약과 검증

- 색상은 `#RGB` 또는 `#RRGGBB`만 허용한다.
- `style`은 `dot`, `ring`만 허용한다.
- `sizePx`는 `10..36`으로 제한한다.
- macOS가 아니면 `onlyOnClicks`는 렌더링 시 false가 된다.
- click capture는 녹화 시작 시 main process에서 시작되므로 녹화 완료 후 새로
  생성할 수 없다.
- preview/export 모두 같은 telemetry와 `effectiveCursorHighlight`를 사용해야 한다.
