# 캔버스 및 미리보기 직접 편집 MCP 연동 분석

## 포함 기능

- 줌 초점 드래그: `ZoomRegion.focus.cx`, `focus.cy`
- 웹캠 PiP 위치 드래그: `webcamPosition.cx`, `webcamPosition.cy`
- 주석 위치/크기 드래그/리사이즈
- 블러 위치/크기 드래그/리사이즈
- 자유형 블러 경로: `blurData.freehandPoints`
- 전체화면 미리보기

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 미리보기 렌더러 | `src/components/video-editor/VideoPlayback.tsx` | PixiJS preview, zoom focus/webcam drag, overlay mounting |
| annotation overlay | `src/components/video-editor/AnnotationOverlay.tsx` | `react-rnd` 기반 위치/크기 변경, freehand blur drawing |
| 편집 state owner | `src/components/video-editor/VideoEditor.tsx` | focus, webcam, annotation, blur update/commit 핸들러 |
| layout 계산 | `src/lib/compositeLayout.ts`, `src/components/video-editor/videoPlayback/layoutUtils.ts` | PiP/stack/dual layout과 stage 좌표 |
| export 반영 | `src/lib/exporter/frameRenderer.ts`, `src/lib/exporter/annotationRenderer.ts` | preview와 같은 상태를 offscreen render에 적용 |

## 상태와 변경 방식

| 기능 | 저장 필드 | 변경 함수 | history 처리 |
| --- | --- | --- | --- |
| 줌 초점 | `zoomRegions[].focus` | `handleZoomFocusChange` | drag 중 `updateState`, pointer up에서 `commitState` |
| 웹캠 PiP 위치 | `webcamPosition` | `onWebcamPositionChange` -> `updateState` | drag 중 live update, drag end commit |
| 주석 위치 | `annotationRegions[].position` | `handleAnnotationPositionChange` | `pushState` |
| 주석 크기 | `annotationRegions[].size` | `handleAnnotationSizeChange` | `pushState` |
| 블러 위치/크기 | blur annotation의 `position`, `size` | annotation과 같은 handler | `pushState` |
| 자유형 블러 | `blurData.freehandPoints` | `handleBlurDataPreviewChange` | drawing 중 update, commit callback |
| 전체화면 | `isFullscreen` | `toggleFullscreen`, Escape key | 저장 안 됨 |

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.preview.state` | resource | current time, selected ids, overlay sizes, fullscreen 여부 | overlay pixel size는 renderer 전용 |
| `openscreen.zoom.focus.set` | tool | `handleZoomFocusChange` + `commitState` | selected zoom이 아니어도 id 지정 가능 |
| `openscreen.webcam.position.set` | tool | `updateState({ webcamPosition })` + `commitState` | PiP layout과 webcam media 필요 |
| `openscreen.annotation.position.set` | tool | `handleAnnotationPositionChange` | percent 좌표 |
| `openscreen.annotation.size.set` | tool | `handleAnnotationSizeChange` | percent 크기 |
| `openscreen.blur.freehand.set` | tool | `handleBlurDataPreviewChange` 또는 panel change | shape를 freehand로 설정하면 position/size는 전체 surface |
| `openscreen.preview.fullscreen.set` | tool | `setIsFullscreen` | 저장 안 됨 |

## MCP 상호 작용 설계

직접 편집은 UI 좌표와 저장 좌표가 다르다. MCP 도구는 pixel 좌표를 받기보다
저장 스키마와 같은 normalized/percent 값을 기본 입력으로 삼는 것이 안정적이다.
`zoom.focus`와 `webcamPosition`은 `0..1`, annotation/blur `position`과 `size`는
`0..100` percent를 사용한다. pixel 기반 도구가 필요하면 renderer resource가
현재 overlay/container 크기를 노출하고, tool 내부에서 저장 좌표로 변환해야 한다.

줌 초점 드래그는 preview가 재생 중이면 비활성이고, 선택된 region의
`focusMode`가 `auto`이면 수동 드래그가 거부된다. `VideoPlayback`은 pointer
down/move에서 stage 좌표를 focus로 변환하고 `clampFocusToStage`를 적용한 뒤
`onZoomFocusChange`를 호출한다. MCP에서도 `focusMode === "auto"`인 region의
수동 focus 변경은 기본적으로 거부하거나, 먼저 focus mode를 `manual`로 바꾸는
명시적 옵션을 요구해야 한다.

웹캠 PiP 위치는 webcam media가 존재하고 `webcamLayoutPreset`이
`picture-in-picture`일 때만 의미가 있다. `vertical-stack`과 `dual-frame`에서는
layout 계산이 preset으로 결정되고 `webcamPosition`은 null 처리된다. MCP tool은
layout 상태를 확인하고 PiP가 아니면 `webcamPosition` 변경을 no-op 또는 오류로
반환해야 한다.

annotation/blur 위치와 크기는 `AnnotationOverlay`가 `react-rnd`의 drag/resize
결과를 overlay 크기 대비 percent로 바꿔 저장한다. freehand blur는 일반 resize가
비활성화되고, 선택된 freehand blur overlay 위에 새 path를 그리면
`freehandPoints`가 annotation bounds 기준 `0..100` 좌표로 저장된다. 현재 설정
패널에는 freehand 선택 UI가 노출되지 않지만 project schema와 renderer/exporter는
처리한다.

전체화면 미리보기는 `VideoEditor.isFullscreen` local state이다. 프로젝트와
export에 영향을 주지 않으므로 MCP 리소스에서는 session UI state로만 보고한다.

## 제약과 검증

- focus와 PiP center는 `0..1`로 clamp한다.
- annotation/blur position은 `0..100`, size는 양수 percent로 제한한다.
- 자유형 blur path는 최소 3개 point가 있어야 유효하다.
- freehand blur는 position `{ x: 0, y: 0 }`, size `{ width: 100, height: 100 }`로
  맞추는 현재 구현을 따른다.
- preview 직접 조작 tool은 저장/내보내기 반영 여부를 명확히 구분한다.
