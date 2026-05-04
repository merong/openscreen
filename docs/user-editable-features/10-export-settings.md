# 내보내기 설정 MCP 연동 분석

## 포함 기능

- 내보내기 형식: MP4, GIF
- MP4 품질: 낮음, 중간, 높음
- GIF 프레임 레이트: `15`, `20`, `25`, `30`
- GIF 크기: `medium`, `large`, `original`
- GIF 반복: 켜기/끄기
- 저장 위치 선택
- 내보내기 취소
- 폴더에서 보기

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 설정 UI | `src/components/video-editor/SettingsPanel.tsx` | format/quality/GIF controls, export button |
| export 실행 | `src/components/video-editor/VideoEditor.tsx` | `handleOpenExportDialog`, `handleExport`, cancel/save result |
| MP4 exporter | `src/lib/exporter/videoExporter.ts` | decode/render/encode/mux |
| GIF exporter | `src/lib/exporter/gifExporter.ts` | decode/render/gif.js encode |
| frame render | `src/lib/exporter/frameRenderer.ts` | 편집 상태를 canvas frame에 적용 |
| 저장 IPC | `electron/ipc/handlers.ts` | save dialog, file write, reveal in folder |
| progress dialog | `src/components/video-editor/ExportDialog.tsx` | progress/cancel/error/show in folder |

## 입력 상태

내보내기는 다음 편집 상태를 읽는다.

- media: `videoPath`, optional `webcamVideoPath`
- layout/effects: `aspectRatio`, `cropRegion`, `wallpaper`, `shadowIntensity`, `showBlur`,
  `motionBlurAmount`, `borderRadius`, `padding`
- timeline: `zoomRegions`, `trimRegions`, `speedRegions`
- overlay: `annotationRegions`, blur annotations 포함
- webcam: `webcamLayoutPreset`, `webcamMaskShape`, `webcamSizePreset`, `webcamPosition`
- cursor: `cursorTelemetry`, `cursorClickTimestamps`, `effectiveCursorHighlight`
- export settings: `exportFormat`, `exportQuality`, `gifFrameRate`, `gifLoop`, `gifSizePreset`

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.export.settings.get` | resource | export state + calculated GIF dimensions | current video metadata 필요 |
| `openscreen.export.settings.set` | tool | export format/quality/GIF setters | project와 user prefs에 반영 |
| `openscreen.export.start` | tool | `handleExport(settings)` | renderer 실행 필요 |
| `openscreen.export.cancel` | tool | `exporterRef.current.cancel()` | MP4/GIF exporter cancel |
| `openscreen.export.savePending` | tool | `handleSaveUnsavedExport` | 사용자가 save dialog 취소한 blob 저장 |
| `openscreen.export.reveal` | tool | `electronAPI.revealInFolder(filePath)` | 저장된 파일 path 필요 |

## MCP 상호 작용 설계

export 실행은 renderer에서 해야 한다. exporter는 `HTMLVideoElement` metadata,
preview container size, browser WebCodecs/canvas/GIF worker에 의존한다. MCP server가
main process에 있더라도 `export.start`는 renderer command로 전달해
`VideoEditor.handleExport`를 호출해야 한다.

`handleOpenExportDialog`는 현재 video metadata와 aspect/crop을 사용해 GIF output
dimension을 미리 계산하고, 선택된 format에 맞는 `ExportSettings`를 만든 뒤 바로
`handleExport`를 시작한다. MCP는 UI dialog가 없어도 같은 `ExportSettings`를 만들어
`handleExport`에 넘기면 된다. MP4 품질은 `medium`이 720p, `good`이 1080p,
`source`가 source resolution 기반이고, 최종 width/height는 even dimension으로
보정된다.

저장 위치 선택은 exporter 완료 후 `electronAPI.saveExportedVideo(arrayBuffer,
fileName)`가 담당한다. 사용자가 save dialog를 취소하면 blob은 `unsavedExport`에
보관되고, 나중에 `handleSaveUnsavedExport`로 다시 저장 위치를 고를 수 있다.
MCP에서 non-interactive export path를 지원하려면 main IPC에 별도 승인된 path write
API를 추가해야 한다. 현재 코드 기준으로는 save dialog 흐름을 재사용하는 것이
안전하다.

취소는 `exporterRef.current.cancel()`을 호출하고 progress/dialog state를 닫는다.
MP4 exporter와 GIF exporter 모두 cancel flag를 확인한다. MCP `export.cancel`은
진행 중인 exporter가 없을 때 no-op 응답을 반환해야 한다.

export progress는 `ExportProgress`로 frame count, percentage, estimated time,
phase/renderProgress를 전달한다. MCP resource로 progress를 노출하려면
`VideoEditor.exportProgress`, `isExporting`, `exportError`, `exportedFilePath`를
현재 export job state로 공개한다.

## 제약과 검증

- video가 로드되지 않았거나 metadata가 준비되지 않았으면 export를 시작하지 않는다.
- GIF frame rate는 `15`, `20`, `25`, `30`만 허용한다.
- GIF size preset은 `medium`, `large`, `original`만 허용한다.
- MP4 품질은 `medium`, `good`, `source`만 허용한다.
- export는 trim/speed를 decode 단계에 반영하고, zoom/annotation/blur/effects는
  frame render 단계에 반영한다.
- save dialog 취소는 export 실패가 아니며 pending blob으로 보관될 수 있다.
