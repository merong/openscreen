# 녹화 HUD와 소스 선택 MCP 연동 분석

## 포함 기능

- 녹화 소스 선택: 전체 화면, 개별 창
- 시스템 오디오: 켜기/끄기
- 마이크: 켜기/끄기, 입력 장치 선택, 레벨 미터
- 웹캠: 켜기/끄기, 카메라 장치 선택
- 녹화 상태: 시작, 정지, 일시정지, 재개, 재시작, 취소
- 기존 영상 열기: `webm`, `mp4`, `mov`, `avi`, `mkv`
- 프로젝트 열기: `.openscreen`, `.json`
- HUD 언어 선택

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| HUD UI | `src/components/launch/LaunchWindow.tsx` | 토글, 장치 선택, 녹화 제어, 파일/프로젝트 열기, 언어 메뉴 |
| 소스 선택 UI | `src/components/launch/SourceSelector.tsx` | `desktopCapturer` 결과를 화면/창 탭으로 표시하고 선택 |
| 녹화 훅 | `src/hooks/useScreenRecorder.ts` | `getUserMedia`, `MediaRecorder`, 카운트다운, 저장/재시작/취소 처리 |
| 장치 훅 | `src/hooks/useMicrophoneDevices.ts`, `src/hooks/useCameraDevices.ts`, `src/hooks/useAudioLevelMeter.ts` | renderer의 media device enumeration 및 레벨 표시 |
| 권한 | `src/lib/requestCameraAccess.ts`, `electron/ipc/handlers.ts` | macOS 카메라/접근성 권한 요청 |
| IPC 노출 | `electron/preload.ts` | `window.electronAPI.*` 브리지 |
| main IPC | `electron/ipc/handlers.ts` | source list, selected source, recording state, file/project picker, cursor telemetry |

## 상태와 side effect

| 상태/데이터 | 소유 위치 | 저장 여부 |
| --- | --- | --- |
| `selectedSource` | `electron/ipc/handlers.ts` module 변수 | 앱 런타임 상태 |
| `recording`, `paused`, `elapsedSeconds` | `useScreenRecorder` state/ref | 저장 안 됨 |
| `microphoneEnabled`, `microphoneDeviceId` | `useScreenRecorder` | 저장 안 됨 |
| `systemAudioEnabled` | `useScreenRecorder` | 저장 안 됨 |
| `webcamEnabled`, `webcamDeviceId` | `useScreenRecorder` | 녹화 결과 세션에는 webcam media path만 저장 |
| 녹화 결과 | `storeRecordedSessionFiles` | `RECORDINGS_DIR`의 screen/webcam webm와 `.session.json` |
| 커서 텔레메트리 | main process cursor buffer | screen video 옆 `.cursor.json` |
| HUD 언어 | `I18nProvider` | `localStorage`와 main process locale |

녹화 완료 흐름은 `useScreenRecorder.finalizeRecording`에서 screen/webcam blob을
`fixWebmDuration`으로 보정한 뒤 `window.electronAPI.storeRecordedSession`에
넘긴다. main process는 안전한 파일명만 받아 `RECORDINGS_DIR`에 저장하고,
같은 recording id의 cursor samples/clicks를 `.cursor.json`으로 flush한다. 이후
renderer는 `setCurrentRecordingSession` 또는 `setCurrentVideoPath`를 호출하고
`switchToEditor`로 편집 창을 연다.

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.sources.list` | resource/tool | `electronAPI.getSources({ types: ["screen", "window"], ... })` | 앱 자기 창 제외 로직은 main IPC 재사용 |
| `openscreen.sources.select` | tool | `electronAPI.selectSource(source)` | `ProcessedDesktopSource` 전체 또는 source id를 받아 main의 `selectedSource` 갱신 |
| `openscreen.recording.options.set` | tool | renderer command가 `setSystemAudioEnabled`, `setMicrophoneEnabled`, `setMicrophoneDeviceId`, `setWebcamEnabled`, `setWebcamDeviceId` 호출 | 녹화 중 변경 불가 |
| `openscreen.recording.start` | tool | `useScreenRecorder.toggleRecording` 또는 start command | source 선택 필요, 3초 카운트다운 포함 |
| `openscreen.recording.stop` | tool | `stopRecording.current()` 경유 | 정상 저장 후 editor 전환 |
| `openscreen.recording.pause` / `resume` | tool | `togglePaused` | screen/webcam recorder를 함께 pause/resume |
| `openscreen.recording.restart` | tool | `restartRecording` | 현재 recording id는 discard 처리 |
| `openscreen.recording.cancel` | tool | `cancelRecording` | 현재 녹화물과 cursor telemetry 폐기 |
| `openscreen.media.openVideo` | tool | `electronAPI.openVideoFilePicker` 또는 승인된 path command | 임의 path를 허용하려면 main의 승인 로직 필요 |
| `openscreen.project.openFromHud` | tool | `electronAPI.loadProjectFile`, `switchToEditor` | 프로젝트 media path 승인 로직 재사용 |
| `openscreen.locale.set` | tool | `I18nProvider.setLocale` | 지원 locale만 허용 |

## MCP 상호 작용 설계

MCP server가 Electron main process 안에서 실행된다면 녹화 시작/토글은 renderer
명령 채널이 필요하다. `getUserMedia`, MediaRecorder, device selection은
renderer 상태와 브라우저 권한 컨텍스트에 의존하기 때문이다. main process MCP
도구가 곧바로 `useScreenRecorder` ref를 만질 수 없으므로, `LaunchWindow`에
명령 dispatcher를 두고 main에서 renderer로 `recording-command` 이벤트를 보내는
방식이 적합하다.

소스 목록과 소스 선택은 이미 main IPC가 소유한다. MCP에서 소스 목록을 조회할
때는 `desktopCapturer.getSources` 래퍼를 그대로 호출하고, 선택 시에는 UI에서
넘기는 `id`, `name`, `display_id`, `thumbnail`, `appIcon` 구조를 유지해야 한다.
`useScreenRecorder.startRecording`은 `electronAPI.getSelectedSource()`로 source id를
읽어 `chromeMediaSourceId`에 넣으므로, MCP가 source를 바꾸면 기존 녹화 시작
흐름이 그대로 반영된다.

마이크/웹캠 장치 목록은 `navigator.mediaDevices`가 renderer에서 제공한다. MCP가
장치 id를 설정하려면 먼저 renderer resource로 현재 장치 목록을 노출하고, tool은
그 목록의 id만 받도록 제한해야 한다. 웹캠 enable은 `requestCameraAccess`와
`getUserMedia` 실패 처리를 포함하므로 단순 boolean 쓰기가 아니라 기존
`setWebcamEnabled` 함수를 호출해야 한다.

녹화 상태 제어 도구는 cursor telemetry lifecycle과 연결된다. 시작 시
`electronAPI.setRecordingState(true, recordingId)`가 main의 cursor buffer와 macOS
click capture를 시작하고, 정지/취소/재시작 시 `setRecordingState(false)`와
`discardCursorTelemetry(recordingId)`가 호출된다. MCP가 이 순서를 우회하면 커서
하이라이트와 자동 줌 추천 데이터가 누락된다.

## 제약과 검증

- 녹화 중에는 source, system audio, microphone, webcam 토글을 거부해야 한다.
- system audio capture 실패는 오류로 종료하지 않고 video-only fallback으로
  계속 진행한다.
- webcam enable은 권한 요청 결과와 실제 stream acquisition 성공 여부를 함께
  확인해야 한다.
- cancel/restart는 저장 결과를 만들지 않고 해당 recording id의 cursor telemetry도
  폐기해야 한다.
- 기존 영상 열기는 main의 `ALLOWED_IMPORT_VIDEO_EXTENSIONS`와 `approvedPaths`
  경계를 재사용해야 한다.
- 프로젝트 열기는 프로젝트 파일 위치, `RECORDINGS_DIR`, 프로젝트 디렉터리 안의
  media path만 자동 승인한다.
