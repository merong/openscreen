# MCP Streamable HTTP 서버 구현 분석

이 문서는 OpenScreen에 `http://127.0.0.1:18888/mcp` 형태의 MCP server를 추가할 때
현재 코드베이스를 어떻게 나누고 연결해야 하는지 정리한다. 목표는 MCP 클라이언트가
OpenScreen의 녹화, 프로젝트, 편집, 내보내기 기능을 도구와 리소스로 호출하되, 기존
Electron 보안 경계와 renderer 상태 모델을 깨지 않는 것이다.

## 결론

MCP HTTP 서버는 Electron main process에서 실행하는 것이 맞다. 포트 바인딩, 파일 접근,
프로젝트 저장, 창 제어, OS 권한 확인은 이미 main process가 담당하고 있기 때문이다.

다만 실제 편집 상태와 녹화 실행은 renderer가 소유한다. `VideoEditor.tsx`의
`useEditorHistory` state, `useScreenRecorder.ts`의 `MediaRecorder`, export의
`VideoExporter`/`GifExporter`는 브라우저 API와 DOM, WebCodecs/canvas/WebGL 컨텍스트에
의존한다. 따라서 main process MCP 서버가 React state를 직접 수정하려 하면 안 되고,
main process와 renderer 사이에 명시적인 command bridge를 추가해야 한다.

권장 구조는 다음과 같다.

```text
MCP client
  -> http://127.0.0.1:18888/mcp
  -> electron/mcp/server.ts
  -> electron/mcp/tools.ts, resources.ts
  -> electron/services/OpenScreenController.ts
       -> main-owned operations
       -> RendererCommandBus
            -> webContents.send("mcp:command", ...)
            -> renderer command handlers in LaunchWindow / VideoEditor
```

## 구현 현황

현재 구현은 위 구조를 실제 코드에 연결한다.

- `electron/mcp/server.ts`가 `@modelcontextprotocol/sdk`의 `StreamableHTTPServerTransport`를
  사용해 `http://127.0.0.1:18888/mcp`에 stateful Streamable HTTP endpoint를 연다.
- `electron/mcp/RendererCommandBus.ts`가 main process에서 renderer로 명령을 보내고,
  `electron/preload.ts`가 `onMcpCommand`/`notifyMcpTargetReady` bridge를 노출한다.
- `src/components/launch/LaunchWindow.tsx`는 HUD/녹화 명령을 처리한다.
- `src/components/video-editor/VideoEditor.tsx`는 프로젝트, 편집 상태, timeline region,
  annotation/blur, crop, cursor highlight, export, shortcuts, preferences 명령을 처리한다.
- `electron/mcp/resources.ts`는 앱 상태, source, recording session, project/editor/export,
  shortcuts/preferences와 MCP 편집 가이드를 read-only MCP resource로 제공한다.
- `openscreen://editing/guide`는 시나리오 작성자와 MCP 실행자가 함께 따라야 하는
  `docs/mcp-editing-guide.md`를 제공한다.
- `openscreen://editing/feature-index`는 편집 기능별 세부 문서 목차인
  `docs/user-editable-features.md`를 제공한다.
- `openscreen://editing/features/...` 리소스는 timeline, annotation, blur, export 같은
  세부 기능 문서를 직접 제공한다.
- `electron/ipc/handlers.ts`의 main-owned 상태 접근 함수를 export해 IPC와 MCP가 같은
  selected source, recording session, project path, shortcut state를 보게 했다.

현재 남은 제한은 다음과 같다.

- timeline range, keyframe, cursor dwell zoom suggestion은 아직 `TimelineEditor` 내부 상태에
  묶여 있어 command가 `supported: false`를 반환한다.
- export는 기존 renderer export 흐름을 호출하므로 저장은 현재 dialog 기반이다.
- bearer 인증은 `OPENSCREEN_MCP_TOKEN`이 설정된 경우에만 강제한다.

## MCP Streamable HTTP 요구사항

최신 MCP spec은 `2025-11-25`이며 Streamable HTTP는 다음 조건을 전제로 한다.

- MCP endpoint는 단일 경로를 제공한다. 이 프로젝트에서는 `/mcp`만 열고 기본 주소를
  `http://127.0.0.1:18888/mcp`로 고정한다.
- JSON-RPC 메시지는 HTTP `POST /mcp`로 수신한다.
- 서버가 SSE를 지원하면 `GET /mcp`로 server-to-client notification stream을 열 수 있다.
  초기 구현은 JSON 응답 모드로 시작해도 되지만, export progress 같은 장기 작업을 노출하려면
  SSE 또는 resource polling을 설계해야 한다.
- 로컬 서버는 `0.0.0.0`이 아니라 `127.0.0.1`에만 bind해야 한다.
- `Origin` header가 있으면 allowlist 검증을 해야 한다. 유효하지 않은 Origin은 `403`으로
  거절한다.
- stateful session을 쓰는 경우 initialize 응답에 `MCP-Session-Id`를 내려주고 이후 요청에서
  같은 header를 요구한다.
- HTTP 기반 요청은 negotiated protocol version에 맞는 `MCP-Protocol-Version` header를
  처리해야 한다.

참고:

- https://modelcontextprotocol.io/specification/2025-11-25/basic/transports
- https://ts.sdk.modelcontextprotocol.io/documents/server.html

## 현재 코드 구조

### Main process가 소유하는 영역

`electron/main.ts`

- 앱 준비 후 `registerIpcHandlers(...)`를 호출한다.
- HUD, editor, source selector, countdown overlay window를 생성한다.
- tray menu와 recording state 표시를 관리한다.
- editor close 시 저장 확인 dialog를 띄운다.

`electron/windows.ts`

- `createHudOverlayWindow`, `createEditorWindow`, `createSourceSelectorWindow`,
  `createCountdownOverlayWindow`가 BrowserWindow를 만든다.
- renderer URL은 `windowType=hud-overlay`, `windowType=editor`, `windowType=source-selector`,
  `windowType=countdown-overlay` query로 구분된다.

`electron/ipc/handlers.ts`

- `selectedSource`, `currentProjectPath`, `currentRecordingSession`, `approvedPaths`,
  cursor telemetry buffer를 module-local state로 들고 있다.
- `get-sources`, `select-source`, `get-selected-source`는 source selector와 recorder가 공유한다.
- `store-recorded-session`, `get-recorded-video-path`, `set-current-video-path`,
  `read-binary-file`, `get-cursor-telemetry`는 녹화 파일과 승인된 파일 경로를 관리한다.
- `save-project-file`, `load-project-file`, `load-current-project-file`은 프로젝트 JSON 파일과
  media path 승인 규칙을 함께 처리한다.
- `get-shortcuts`, `save-shortcuts`, `set-locale`, permission 요청도 IPC로 노출된다.

이 파일은 MCP 서버와 공유해야 할 main-owned 기능이 많지만, 현재는 `ipcMain.handle(...)`
안에 직접 구현되어 있다. MCP 추가 전에 file access, project IO, source selection,
recording session state를 service/controller로 분리해야 중복 구현을 피할 수 있다.

### Renderer가 소유하는 영역

`src/hooks/useScreenRecorder.ts`

- 실제 녹화 시작/중지/일시정지는 renderer의 `MediaRecorder`와
  `navigator.mediaDevices.getUserMedia`에 의존한다.
- 녹화 종료 후 `storeRecordedSession`, `setCurrentRecordingSession`, `switchToEditor` IPC를
  순서대로 호출한다.
- main process는 recording state와 cursor telemetry를 보조할 뿐, media stream 자체를 소유하지
  않는다.

`src/components/launch/LaunchWindow.tsx`

- HUD UI 상태를 가진다. microphone/system audio/webcam enabled, device id, selected source label,
  countdown/recording controls가 여기에 연결된다.
- source list 자체는 main IPC에서 가져오지만, mic/camera device list는 renderer Web API에서 온다.

`src/components/video-editor/VideoEditor.tsx`

- `useEditorHistory`가 편집 가능한 핵심 상태를 소유한다.
- 프로젝트 저장 시 `createProjectData(currentProjectMedia, editorState)`를 만들고
  `saveProjectFile` IPC에 넘긴다.
- 프로젝트 로드 시 `applyLoadedProject`가 renderer state를 복원한다.
- export는 `VideoExporter`/`GifExporter`를 renderer에서 생성하고, 완료된 blob만 main IPC로 저장한다.

`src/hooks/useEditorHistory.ts`

- undoable editor state와 undo/redo stack을 관리한다.
- MCP가 편집 상태를 바꿀 때도 `pushState`, 연속 preview 변경은 `updateState`/`commitState`를
  써야 기존 undo 동작과 일관된다.

## 먼저 해결할 코드 정리

### 1. IPC handler 내부 상태를 controller로 분리

`electron/ipc/handlers.ts`는 MCP가 써야 할 상태와 로직을 닫힌 module-local 변수로 갖고 있다.
권장 리팩터링은 다음과 같다.

```text
electron/services/fileAccess.ts
  - approveFilePath
  - approveReadableVideoPath
  - isPathAllowed
  - RECORDINGS_DIR policy

electron/services/projectStore.ts
  - saveProjectFile
  - loadProjectFile
  - loadCurrentProjectFile
  - getApprovedProjectSession

electron/services/recordingStore.ts
  - storeRecordedSessionFiles
  - getCurrentRecordingSession
  - setCurrentRecordingSession
  - getRecordedVideoPath
  - getCursorTelemetry

electron/services/sourceStore.ts
  - listSources
  - selectSource
  - getSelectedSource

electron/services/OpenScreenController.ts
  - 위 service들과 window actions를 묶는 facade
```

그 다음 `registerIpcHandlers(controller, ...)`와 `startMcpServer(controller, commandBus)`가
같은 controller를 주입받도록 만든다. 이렇게 해야 `approvedPaths`, `currentProjectPath`,
`currentRecordingSession`이 IPC와 MCP에서 서로 다른 값으로 갈라지지 않는다.

### 2. RendererCommandBus 추가

main process에서 renderer 기능을 호출하려면 command bus가 필요하다. 최소 API는 다음과 같다.

```ts
type RendererCommandTarget = "hud" | "editor";

interface RendererCommandBus {
	send<TArgs, TResult>(
		target: RendererCommandTarget,
		method: string,
		args: TArgs,
		options?: { timeoutMs?: number; ensureWindow?: boolean },
	): Promise<TResult>;
}
```

main process 구현은 `BrowserWindow.webContents.send("mcp:command", envelope)`로 명령을 보내고,
preload는 `onMcpCommand`와 `resolveMcpCommand`를 안전하게 노출한다. renderer는 mount 시
`window.electronAPI.onMcpCommand(...)`를 등록하고, 결과를 `ipcRenderer.invoke`나
`ipcRenderer.send`로 돌려준다.

필수 동작:

- command id를 생성하고 pending promise를 timeout과 함께 보관한다.
- editor 명령인데 editor window가 없으면 `createEditorWindowWrapper()`로 열고 load 완료 후 전송한다.
- hud 명령인데 HUD가 없으면 `showMainWindow()` 또는 `switchToHudWrapper()`를 통해 준비한다.
- 동시에 들어온 mutation은 queue나 mutex로 직렬화한다. 특히 export와 project load/save는 single-flight로
  처리한다.
- window가 닫히면 해당 window로 보낸 pending command를 실패 처리한다.

### 3. Renderer command handler 추가

`VideoEditor.tsx`가 받을 command 예시는 다음과 같다.

- `editor.getState`
- `editor.applyProjectEditorPatch`
- `editor.addRegion`
- `editor.updateRegion`
- `editor.deleteRegion`
- `editor.seek`
- `editor.play`
- `editor.pause`
- `project.save`
- `project.loadCurrent`
- `export.start`
- `export.cancel`

`LaunchWindow.tsx` 또는 `useScreenRecorder.ts`가 받을 command 예시는 다음과 같다.

- `recorder.getState`
- `recorder.setOptions`
- `recorder.start`
- `recorder.stop`
- `recorder.pause`
- `recorder.resume`
- `recorder.cancel`
- `devices.listMicrophones`
- `devices.listCameras`

현재 `useScreenRecorder`는 외부에서 start/stop을 직접 호출할 공용 명령 인터페이스가 없다.
MCP 녹화 도구를 구현하려면 hook 반환값 또는 별도 context에 command registration을 추가해야 한다.

## 서버 위치와 생명주기

새 파일 구성을 권장한다.

```text
electron/mcp/server.ts
electron/mcp/tools.ts
electron/mcp/resources.ts
electron/mcp/prompts.ts
electron/mcp/security.ts
electron/mcp/schemas.ts
electron/mcp/RendererCommandBus.ts
```

`electron/main.ts`의 `app.whenReady()` 안에서 controller와 IPC를 구성한 뒤 MCP 서버를 시작한다.

```ts
const controller = createOpenScreenController({ ...windowActions });
registerIpcHandlers(controller);
const commandBus = createRendererCommandBus({ ...windowGettersAndCreators });
await startMcpServer({
	host: "127.0.0.1",
	port: 18888,
	path: "/mcp",
	controller,
	commandBus,
});
```

서버 start 시점은 `ensureRecordingsDir()` 이후가 좋다. `recordings.latest`,
`project.save`, `media.read` 같은 도구가 `RECORDINGS_DIR`에 의존하기 때문이다.

포트 `18888`은 사용자가 지정한 endpoint와 맞아야 하므로 다른 포트로 조용히 fallback하지 않는다.
`EADDRINUSE`가 발생하면 tray/menu나 로그에 명확히 표시하고 MCP 서버만 비활성화한다. 필요하면
추후 `OPENSCREEN_MCP_PORT` 같은 override를 추가하되 기본값은 고정한다.

## SDK 선택

현재 구현은 `package.json`에 다음 dependency를 추가한다.

추가 dependency:

- `@modelcontextprotocol/sdk`
- `zod`

Electron main process는 ESM이고 Node 22를 사용하므로 SDK의 ESM import와 Node HTTP transport를
사용하기에 적합하다. 단, SDK의 HTTP adapter API는 버전별 변화가 있었으므로 `electron/mcp/server.ts`에
transport 세부 구현을 격리한다. 앱 내부 tool/resource 등록 코드는 SDK transport와 직접 결합하지 않게
두는 것이 좋다.

## MCP 리소스 설계

리소스는 가능한 한 read-only 상태 조회로 제한한다.

| URI | 내용 | 내부 경계 |
| --- | --- | --- |
| `openscreen://editing/guide` | 편집 시나리오 작성과 MCP 실행 규칙 | `docs/mcp-editing-guide.md` |
| `openscreen://editing/feature-index` | 기능별 편집 문서 목차 | `docs/user-editable-features.md` |
| `openscreen://editing/features/...` | 기능별 MCP tool/resource 연동 세부 문서 | `docs/user-editable-features/*.md` |
| `openscreen://app/status` | 앱 버전, platform, window 상태, MCP 서버 상태 | main controller |
| `openscreen://sources` | 현재 desktopCapturer source 목록과 selected source | main controller |
| `openscreen://recording/session` | current recording session, latest recording path | recording store |
| `openscreen://project/current` | 현재 project path, media, saved/unsaved 상태 | main + editor command |
| `openscreen://editor/state` | 현재 `ProjectEditorState`, selection, currentTime, duration | editor command |
| `openscreen://editor/options` | aspect ratio, export quality, GIF presets, shortcut actions 등 가능한 enum | shared TS constants |
| `openscreen://cursor/telemetry` | 현재 media의 cursor samples/clicks | recording store |
| `openscreen://export/progress` | 진행 중 export 상태 | editor command 또는 main cache |
| `openscreen://shortcuts` | 현재 shortcut config | main shortcut file |
| `openscreen://preferences` | padding/aspect/export defaults, locale | renderer localStorage + main locale |

`openscreen://editor/state`는 renderer에서 받아오는 것이 맞다. main process의
`currentRecordingSession`만으로는 `zoomRegions`, `trimRegions`, `annotationRegions`,
`cropRegion`, `cursorHighlight` 등 실제 편집 상태를 알 수 없다.

## MCP 도구 설계

### Main process에서 바로 처리 가능한 도구

| Tool | 역할 | 구현 경계 |
| --- | --- | --- |
| `sources.list` | 녹화 가능한 화면/창 목록 조회 | `desktopCapturer.getSources` |
| `sources.select` | source id 선택 | `select-source` 로직 |
| `recordings.latest` | 최신 녹화 path 조회 | `getRecordedVideoPath` 로직 |
| `media.set_current` | 승인된 video path를 current session으로 설정 | `set-current-video-path` 로직 |
| `project.load_current` | `currentProjectPath`의 프로젝트 다시 로드 | project store |
| `shortcuts.get` | shortcuts JSON 조회 | shortcut store |
| `shortcuts.set` | shortcuts JSON 저장 | `findConflict`, `mergeWithDefaults` 검증 후 저장 |
| `locale.set` | 앱 locale 변경 | `setMainLocale`, renderer command 동시 호출 |
| `app.show_hud` | HUD 표시 | window action |
| `app.show_editor` | editor 표시 | window action |

### Renderer 위임이 필요한 도구

| Tool | 역할 | 위임 대상 |
| --- | --- | --- |
| `recorder.configure` | mic/system audio/webcam/device 설정 | HUD command |
| `recorder.start` | countdown 또는 즉시 녹화 시작 | HUD/useScreenRecorder command |
| `recorder.stop` | 녹화 종료 및 editor 전환 | HUD/useScreenRecorder command |
| `recorder.pause` / `recorder.resume` | MediaRecorder pause/resume | HUD/useScreenRecorder command |
| `recorder.cancel` | 녹화 폐기 및 cursor telemetry discard | HUD/useScreenRecorder command |
| `editor.patch` | project editor state 일부 변경 | VideoEditor command |
| `editor.add_timeline_region` | zoom/trim/speed/annotation/blur 추가 | VideoEditor command |
| `editor.update_timeline_region` | region span/data 변경 | VideoEditor command |
| `editor.delete_timeline_region` | region 삭제 | VideoEditor command |
| `editor.seek` | preview seek | VideoEditor command |
| `editor.playback` | play/pause/toggle | VideoEditor command |
| `project.save` | 현재 project 저장 | VideoEditor `saveProject` command |
| `export.start` | 현재 renderer 상태로 export 시작 | VideoEditor `handleExport` command |
| `export.cancel` | 진행 중 exporter 취소 | VideoEditor command |

### 파일 경로를 받는 도구의 정책

현재 앱은 파일 picker나 project load로 승인된 path만 `read-binary-file`에서 읽는다.
MCP가 임의 path를 받으면 이 정책을 우회할 수 있으므로 기본 정책은 다음과 같이 둔다.

- 읽기: `RECORDINGS_DIR` 또는 기존 승인 path만 허용한다.
- project load: 사용자가 file picker로 승인한 프로젝트만 허용하는 현재 흐름을 유지한다.
- non-interactive path load가 필요하면 별도 설정에서 명시적으로 허용된 workspace/root를 등록한다.
- 쓰기: 기본은 Electron save dialog를 유지한다.
- non-interactive export path가 필요하면 `RECORDINGS_DIR/exports` 같은 앱 관리 directory로 제한한다.

## Project/editor state 주의점

MCP tool schema는 `ProjectEditorState`와 `normalizeProjectEditor`를 기준으로 만들어야 한다.
현재 저장 가능한 주요 필드는 다음이다.

- `wallpaper`
- `shadowIntensity`
- `showBlur`
- `motionBlurAmount`
- `borderRadius`
- `padding`
- `cropRegion`
- `zoomRegions`
- `trimRegions`
- `speedRegions`
- `annotationRegions`
- `aspectRatio`
- `webcamLayoutPreset`
- `webcamMaskShape`
- `webcamSizePreset`
- `webcamPosition`
- `exportQuality`
- `exportFormat`
- `gifFrameRate`
- `gifLoop`
- `gifSizePreset`
- `cursorHighlight`

구현 전 보정해야 할 현재 코드상 gap:

- `VideoEditor.tsx`의 `currentProjectSnapshot` 생성 입력에 `webcamSizePreset`과
  `cursorHighlight`가 빠져 있다.
- `applyLoadedProject`의 `pushState` 입력에도 `webcamSizePreset`과 `cursorHighlight` 복원이
  빠져 있다.
- 반면 `saveProject`는 두 값을 `projectData`에 포함한다. MCP가 이 값을 자주 바꾸면 저장되지 않은
  변경 표시와 project round-trip이 어긋날 수 있으므로 MCP 구현 전에 동일한 state surface로 맞춘다.

MCP 편집 도구는 다음 규칙을 따른다.

- region id를 클라이언트가 임의 생성하지 않게 한다. renderer의 `deriveNextId` 흐름 또는 command가
  생성한 id를 반환한다.
- `startMs < endMs`를 강제하고, 영상 duration이 있으면 범위를 clamp한다.
- crop은 normalized `{ x, y, width, height }`를 canonical 입력으로 삼는다.
- overlay position/size는 현재 코드와 동일하게 percent 좌표를 쓴다.
- blur freehand points는 annotation bounds 안의 `0..100` 좌표로 검증한다.
- speed는 `MIN_PLAYBACK_SPEED..MAX_PLAYBACK_SPEED`와 `clampPlaybackSpeed`를 적용한다.
- undo 가능한 변경은 renderer에서 `pushState`를 사용한다.

## Export 연계

Export는 main process에서 직접 실행하지 않는다.

이유:

- `VideoExporter`와 `GifExporter`는 renderer의 video element, preview container size, canvas/WebGL,
  WebCodecs 계열 API에 의존한다.
- 현재 export 설정은 `VideoEditor.tsx`가 video metadata와 crop/aspect ratio를 바탕으로 width/height/bitrate를
  계산한다.
- 완료 후에만 `saveExportedVideo` IPC로 ArrayBuffer를 main process에 넘긴다.

권장 command:

```ts
export.start({
	format: "mp4" | "gif",
	quality?: "medium" | "good" | "source",
	gifConfig?: {
		frameRate: 15 | 20 | 25 | 30;
		loop: boolean;
		sizePreset: "medium" | "large" | "original";
	},
	saveMode?: "dialog" | "managed-directory";
})
```

초기 버전은 `saveMode: "dialog"`만 지원해도 된다. 자동화용 저장 경로가 필요하면 main process에
`saveExportedVideoToManagedPath` 같은 별도 IPC를 추가하고, 저장 directory를 앱이 소유하는 경로로
제한한다.

진행률은 두 방식 중 하나를 선택한다.

- 간단한 방식: `openscreen://export/progress` resource polling.
- 더 MCP다운 방식: Streamable HTTP SSE notification으로 progress 업데이트 전송.

초기 구현은 polling이 간단하고 충분하다.

## 녹화 연계

녹화 시작/중지는 renderer를 통해 실행해야 한다. main process는 다음만 담당한다.

- source list와 selected source 보관
- recording tray 상태 업데이트
- cursor telemetry sampling start/end
- recording files 저장

MCP `recorder.start`는 다음 순서를 따라야 한다.

1. main process에서 selected source가 있는지 확인한다.
2. 필요하면 `sources.list`와 `sources.select`로 source를 먼저 고르게 한다.
3. HUD command로 mic/system audio/webcam 설정을 적용한다.
4. HUD command로 countdown 또는 즉시 녹화를 시작한다.
5. renderer가 기존 `setRecordingState(true, recordingId)`를 호출하게 둔다.
6. stop 시 renderer가 blob을 만들고 `storeRecordedSession`을 호출하게 둔다.
7. 저장 성공 후 기존 흐름대로 `switchToEditor`를 실행한다.

MCP가 main process에서 `set-recording-state`만 직접 호출하면 실제 MediaRecorder가 시작되지 않는다.
이 도구는 cursor telemetry/tray 보조 상태일 뿐이다.

## 보안 모델

기본값:

- host: `127.0.0.1`
- port: `18888`
- path: `/mcp`
- bind to localhost only
- Origin allowlist: absent Origin은 native client 호환을 위해 허용, present Origin은
  `http://127.0.0.1:18888`, `http://localhost:18888` 또는 설정된 UI origin만 허용
- Host header allowlist: `127.0.0.1:18888`, `localhost:18888`
- CORS wildcard 금지
- destructive/non-interactive file write 금지

인증:

- 로컬 앱이라도 bearer token을 권장한다.
- 앱 시작 시 random token을 만들고, MCP 설정 화면 또는 로그가 아닌 안전한 UI에서 복사하게 한다.
- `Authorization: Bearer <token>`이 없으면 tool/resource 요청을 거절한다.
- 개발 편의상 `OPENSCREEN_MCP_DISABLE_AUTH=true` 같은 플래그를 둘 수 있지만 기본값은 auth on이 안전하다.

권한이 필요한 도구:

- screen recording, microphone, camera, accessibility permission은 OS prompt가 필요할 수 있다.
- MCP 도구는 권한이 없을 때 자동 우회하지 말고 `{ needsUserAction: true, permission: "camera" }`처럼
  구조화된 결과를 반환한다.
- macOS Accessibility는 `systemPreferences.isTrustedAccessibilityClient(true)`가 prompt를 열 수는
  있지만 사용자가 System Settings에서 직접 허용해야 한다.

## 세션과 동시성

OpenScreen은 단일 앱 인스턴스와 단일 active editor에 가깝다. MCP session은 여러 개가 붙을 수 있지만
mutation은 전역 상태를 바꾼다.

권장 정책:

- MCP transport는 stateful session을 사용한다.
- read-only resource는 병렬 허용한다.
- mutation tool은 전역 mutex로 직렬화한다.
- export 중에는 project load, editor patch, recorder start를 거절하거나 queue하지 않고 명확히 실패시킨다.
- recording 중에는 source select, project load, export를 제한한다.
- 같은 session이 아니라도 충돌하는 mutation은 동일한 lock을 공유한다.

## Prompts

초기 prompts는 적게 둔다.

| Prompt | 목적 |
| --- | --- |
| `record-screen-setup` | source 선택, mic/system audio/webcam 옵션을 묻는 녹화 준비 프롬프트 |
| `edit-current-project` | 현재 project state를 요약하고 변경 가능한 필드를 안내 |
| `export-current-video` | MP4/GIF 설정과 저장 방식을 묻는 export 프롬프트 |

Prompts는 side effect를 만들지 않는다. 실제 작업은 tool call로 분리한다.

## 구현 단계

1. `ipc/handlers.ts`의 공유 로직을 services/controller로 분리한다.
2. `VideoEditor.tsx`의 project snapshot/load gap(`webcamSizePreset`, `cursorHighlight`)을 먼저 고친다.
3. `RendererCommandBus`와 preload API를 추가한다.
4. `VideoEditor`와 `LaunchWindow`에 read-only command부터 등록한다.
5. MCP SDK와 `zod`를 추가하고 `electron/mcp/server.ts`를 만든다.
6. `/mcp` endpoint를 `127.0.0.1:18888`에 bind하고 initialize/list/read-only resources만 먼저 제공한다.
7. main-only tools(`sources.list`, `sources.select`, `recordings.latest`)를 추가한다.
8. editor mutation tools를 추가하고 undo/redo, unsaved guard를 확인한다.
9. recorder tools를 추가한다.
10. export tools와 progress resource/SSE를 추가한다.
11. auth, Origin/Host 검증, session cleanup, port collision 처리를 테스트한다.

## 테스트 계획

Unit/Vitest:

- `normalizeProjectEditor` 기반 MCP input clamp 테스트.
- file access service가 `RECORDINGS_DIR` 밖 path를 거절하는지 테스트.
- shortcut update가 fixed shortcut conflict를 거절하는지 테스트.
- command bus timeout/window closed 처리를 테스트.
- Origin/Host/auth middleware 테스트.

Integration:

- SDK client로 `initialize -> tools/list -> resources/list -> resources/read` smoke test.
- `sources.list`와 `sources.select`가 기존 HUD source state와 같은 값을 공유하는지 확인.
- editor window가 닫힌 상태에서 `editor.getState` 호출 시 window 생성 후 응답하는지 확인.
- mutation tool 호출 후 `hasUnsavedChanges`와 project save 결과가 일치하는지 확인.

E2E:

- `recorder.start/stop`은 실제 screen permission과 OS별 차이가 커서 platform별 smoke test로 분리한다.
- `export.start`는 기존 `tests/e2e/gif-export.spec.ts`와 browser exporter tests를 확장한다.

## 첫 PR 범위 제안

첫 PR은 서버 골격과 read-only 기능까지만 포함하는 것이 안전하다.

포함:

- MCP dependency 추가
- `electron/mcp/server.ts`
- security middleware
- controller/service 분리 일부
- `openscreen://app/status`, `openscreen://sources`, `openscreen://recording/session`
- `sources.list`, `sources.select`, `recordings.latest`
- protocol smoke test

제외:

- 녹화 시작/중지
- editor mutation
- export 실행
- non-interactive arbitrary path read/write

이렇게 나누면 HTTP 서버, 보안, 세션, main-owned state 공유를 먼저 안정화한 뒤 renderer command bridge와
편집/export 도구를 별도 PR에서 검증할 수 있다.
