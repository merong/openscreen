# 프로젝트 및 미디어 관리 MCP 연동 분석

## 포함 기능

- 새 녹화 시작
- 프로젝트 저장
- 다른 이름으로 저장
- 프로젝트 불러오기
- 저장되지 않은 변경 추적
- 프로젝트 파일에 저장되는 전체 편집 상태

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 프로젝트 state 생성/검증 | `src/components/video-editor/projectPersistence.ts` | `ProjectEditorState`, `createProjectData`, `normalizeProjectEditor`, snapshot 비교 |
| 편집기 적용 | `src/components/video-editor/VideoEditor.tsx` | `applyLoadedProject`, `saveProject`, `currentProjectSnapshot`, menu listener |
| 미디어 세션 | `src/lib/recordingSession.ts` | screen/webcam media path normalize |
| 파일 접근/저장 IPC | `electron/ipc/handlers.ts` | project dialog, path 승인, current project/session state |
| preload API | `electron/preload.ts` | `saveProjectFile`, `loadProjectFile`, `loadCurrentProjectFile`, `setHasUnsavedChanges` |

## 저장 스키마

`EditorProjectData`는 `{ version, media, editor }` 구조이다. `media`는
`screenVideoPath`와 선택적 `webcamVideoPath`를 담고, `editor`는 아래 필드를
저장한다.

| 필드 | 타입/내용 | MCP 연동 시 주의 |
| --- | --- | --- |
| `wallpaper` | 이미지 path/data URL, HEX 색상, CSS gradient | `normalizeWallpaperValue`로 legacy file wallpaper 정규화 |
| `shadowIntensity` | number | 현재 normalize는 숫자 여부만 확인 |
| `showBlur` | boolean | 배경 블러 |
| `motionBlurAmount` | `0..1` | legacy `motionBlurEnabled`도 읽음 |
| `borderRadius` | number | UI는 `0..16` |
| `padding` | `0..100` | `vertical-stack`에서는 UI 비활성 |
| `cropRegion` | normalized `{ x, y, width, height }` | `0..1`, 최소 `0.01` |
| `zoomRegions` | `ZoomRegion[]` | 시간/깊이/focus/focusMode/3D preset 정규화 |
| `trimRegions` | `TrimRegion[]` | 시간 정규화 |
| `speedRegions` | `SpeedRegion[]` | `0.1..16` 속도 정규화 |
| `annotationRegions` | `AnnotationRegion[]` | 텍스트/이미지/화살표/블러를 모두 저장 |
| `aspectRatio` | 지원 종횡비 | 잘못된 값은 `16:9` |
| `webcamLayoutPreset` | PiP/stack/dual | 종횡비와 호환되지 않으면 PiP |
| `webcamMaskShape` | rectangle/circle/square/rounded | PiP에서만 의미 있음 |
| `webcamSizePreset` | `10..50` | PiP webcam 크기 |
| `webcamPosition` | `{ cx, cy }` 또는 null | PiP에서만 유지 |
| `exportQuality` | `medium`, `good`, `source` | 프로젝트와 사용자 기본 설정 양쪽에 영향 |
| `exportFormat` | `mp4`, `gif` | 프로젝트와 사용자 기본 설정 양쪽에 영향 |
| `gifFrameRate` | `15`, `20`, `25`, `30` | GIF 전용 |
| `gifLoop` | boolean | GIF 전용 |
| `gifSizePreset` | `medium`, `large`, `original` | GIF 전용 |
| `cursorHighlight` | `CursorHighlightConfig` | 색상/크기/offset 정규화 |

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.project.current` | resource | `VideoEditor`의 `currentProjectMedia`, `editorState`, export 설정 | React state가 source of truth |
| `openscreen.project.snapshot` | resource | `createProjectSnapshot(currentProjectMedia, editorState)` | unsaved 비교에 사용 |
| `openscreen.project.save` | tool | `VideoEditor.saveProject(false)` | trusted current project path이면 덮어쓰기 |
| `openscreen.project.saveAs` | tool | `VideoEditor.saveProject(true)` | OS save dialog 또는 명시 승인 path |
| `openscreen.project.load` | tool | `electronAPI.loadProjectFile` 후 `applyLoadedProject` | media path 승인과 normalize 필수 |
| `openscreen.project.applyEditorState` | tool | `normalizeProjectEditor` 후 `pushState` + export 설정 setter | 외부 도구가 전체 editor state를 패치할 때 |
| `openscreen.project.startNewRecording` | tool | `electronAPI.startNewRecording` | 현 세션 state를 버리고 HUD 전환 |
| `openscreen.media.current` | resource | `electronAPI.getCurrentRecordingSession` 또는 `currentProjectMedia` | screen/webcam path 조회 |

## MCP 상호 작용 설계

프로젝트 변경 도구는 renderer의 `VideoEditor` command 계층에서 실행되어야 한다.
`ProjectEditorState`의 대부분은 React history state이고, `exportQuality`,
`exportFormat`, GIF 설정은 별도 `useState`이므로 main process만으로는 일관된
snapshot을 만들 수 없다. MCP 도구가 editor state를 패치할 때는
`normalizeProjectEditor`를 통과시킨 뒤 undo 가능한 변경이면 `pushState`, 실시간
drag/slider 성격이면 `updateState`와 `commitState`를 사용한다.

저장 흐름은 `saveProject`를 재사용한다. 이 함수는 현재 media path를
`currentProjectMedia`로 계산하고, `createProjectData`로 project JSON을 만든 뒤
`electronAPI.saveProjectFile`에 넘긴다. main process는 현재 프로젝트 경로와
일치하는 trusted path에만 dialog 없이 덮어쓰고, 그렇지 않으면 save dialog를
띄운다. MCP가 임의 경로 저장을 지원하려면 이 trusted path 규칙을 확장하거나
별도 사용자 승인을 요구해야 한다.

불러오기 흐름은 반드시 `applyLoadedProject`를 거쳐야 한다. 이 함수는
`validateProjectData`, `resolveProjectMedia`, `normalizeProjectEditor`를 수행하고
screen/webcam file URL 변환, selection 초기화, next id 재계산, 마지막 저장
snapshot 갱신까지 처리한다. MCP가 JSON을 직접 주입하는 경우에도 동일한 함수를
재사용해야 id 충돌과 unsaved baseline 오류를 피할 수 있다.

저장되지 않은 변경은 `currentProjectSnapshot`과 `lastSavedSnapshot`의 문자열
비교로 계산되고, `electronAPI.setHasUnsavedChanges`를 통해 main process close
guard에 전달된다. MCP가 project state를 바꾸면 snapshot이 자동 변경되도록
renderer state를 갱신해야 하며, main process 파일만 수정하는 방식은 UI의
unsaved 상태와 어긋난다.

## 제약과 검증

- `media.screenVideoPath`가 없으면 project는 유효하지 않다.
- project load 시 media path는 `RECORDINGS_DIR` 또는 프로젝트 파일 디렉터리 안의
  지원 영상 확장자만 자동 승인한다.
- `.openscreen`과 `.json` 모두 열 수 있지만 저장 기본 확장자는 `.openscreen`이다.
- 기존 저장 경로 덮어쓰기는 `currentProjectPath`와 요청 path가 normalize 후
  같은 경우에만 허용된다.
- `normalizeProjectEditor`가 값 범위를 보정하므로 MCP 입력도 저장 전후 동일한
  정규화 결과를 기준으로 응답해야 한다.
- 임시 상태(current time, selection id, fullscreen, timeline range, keyframes)는
  project JSON에 넣지 않는다.
