# 타임라인 편집 MCP 연동 분석

## 포함 기능

- 재생 위치: 클릭, playhead drag, 좌/우 방향키 프레임 이동
- 타임라인 보기: scroll pan, `Ctrl/Cmd + Scroll` zoom
- 줌 구간: 추가, 자동 추천, 이동/리사이즈, 삭제
- 줌 배율, 수동/자동 초점, 3D 회전 preset
- 트림 구간: 추가, 이동/리사이즈, 삭제
- 속도 구간: 추가, 이동/리사이즈, 삭제, preset/custom speed
- 주석 구간: 추가, 이동/리사이즈, 삭제, overlapping annotation 순환 선택
- 블러 구간: 추가, 이동/리사이즈, 삭제
- 키프레임: 추가, 이동, 선택 후 삭제

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 타임라인 UI | `src/components/video-editor/timeline/TimelineEditor.tsx` | add/delete/selection/keyframe/range 관리 |
| drag/resize | `src/components/video-editor/timeline/TimelineWrapper.tsx` | span clamp, overlap 방지, tooltip |
| item 렌더링 | `src/components/video-editor/timeline/Item.tsx` | row item drag target, label, selection |
| 편집 state owner | `src/components/video-editor/VideoEditor.tsx` | region 생성/수정/삭제 핸들러 |
| history | `src/hooks/useEditorHistory.ts` | `pushState`, `updateState`, `commitState`, undo/redo |
| 재생 이벤트 | `src/components/video-editor/videoPlayback/videoEventHandlers.ts` | trim skip, speed playbackRate 적용 |
| 줌 추천 | `src/components/video-editor/timeline/zoomSuggestionUtils.ts` | cursor dwell 기반 자동 줌 후보 |

## 상태 모델

| 기능 | 저장 필드 | 임시 필드 |
| --- | --- | --- |
| 재생 위치 | 저장 안 됨 | `VideoEditor.currentTime`, video element `currentTime` |
| 타임라인 보기 | 저장 안 됨 | `TimelineEditor.range` |
| 줌 | `zoomRegions` | `selectedZoomId` |
| 트림 | `trimRegions` | `selectedTrimId` |
| 속도 | `speedRegions` | `selectedSpeedId` |
| 주석 | `annotationRegions` 중 `type !== "blur"` | `selectedAnnotationId` |
| 블러 | `annotationRegions` 중 `type === "blur"` | `selectedBlurId` |
| 키프레임 | 저장 안 됨 | `TimelineEditor.keyframes`, `selectedKeyframeId` |

`zoomRegions`, `trimRegions`, `speedRegions`는 같은 종류 안에서 겹침을 허용하지
않는다. `annotationRegions`와 blur annotation은 같은 시간에 겹칠 수 있다.
timeline item의 최소 길이는 `TimelineEditor`에서 100ms이고, 새 region 기본 길이는
영상 길이의 5%이면서 최소 1초로 계산된다.

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.timeline.state` | resource | region 배열, current time, duration, selected ids, range | range/keyframes는 임시 상태 |
| `openscreen.timeline.seek` | tool | `VideoEditor.handleSeek` 또는 video ref `currentTime` | project dirty 아님 |
| `openscreen.timeline.zoom.add` | tool | `handleZoomAdded`/Timeline add rule | overlap과 기본 duration 검증 |
| `openscreen.timeline.zoom.suggest` | tool | `handleZoomSuggested` + `detectZoomDwellCandidates` | cursor telemetry 필요 |
| `openscreen.timeline.zoom.update` | tool | `handleZoomSpanChange`, `handleZoomDepthChange`, `handleZoomFocusModeChange`, `handleZoomRotationPresetChange` | span/depth/focusMode/rotation 변경 |
| `openscreen.timeline.zoom.delete` | tool | `handleZoomDelete` | selection 정리 포함 |
| `openscreen.timeline.trim.add/update/delete` | tool | `handleTrimAdded`, `handleTrimSpanChange`, `handleTrimDelete` | export/preview에서 skip |
| `openscreen.timeline.speed.add/update/delete` | tool | `handleSpeedAdded`, `handleSpeedSpanChange`, `handleSpeedChange`, `handleSpeedDelete` | speed는 `0.1..16` |
| `openscreen.timeline.annotation.add/update/delete` | tool | `handleAnnotationAdded`, `handleAnnotationSpanChange`, `handleAnnotationDelete` | 상세 설정은 annotation 문서 참조 |
| `openscreen.timeline.blur.add/update/delete` | tool | `handleBlurAdded`, `handleAnnotationSpanChange`, `handleAnnotationDelete` | blur도 `annotationRegions`에 저장 |
| `openscreen.timeline.keyframe.*` | tool/resource | `TimelineEditor` local state | 프로젝트/내보내기 비반영 |

## MCP 상호 작용 설계

타임라인 변경은 `VideoEditor`의 region 핸들러를 재사용해야 한다. 새 region id는
`nextZoomIdRef`, `nextTrimIdRef`, `nextSpeedIdRef`, `nextAnnotationIdRef`에서
생성되고, 프로젝트 load 후 `deriveNextId`로 재계산된다. MCP가 id를 직접 만들면
충돌 가능성이 있으므로 기본은 서버가 id를 받지 않고 renderer command가 id를
생성하도록 한다. 외부 id 주입이 필요하면 load/apply 단계에서 `deriveNextId`를
다시 맞춰야 한다.

span 변경은 `TimelineWrapper`의 clamp/overlap 규칙과 같은 규칙을 따라야 한다.
MCP 도구가 `{ startMs, endMs }`를 받으면 먼저 영상 길이와 최소 길이로 clamp하고,
줌/트림/속도는 같은 row의 기존 span과 겹치지 않는지 확인한다. UI drag는 겹치면
가까운 이웃 경계로 clamp하고 그래도 겹치면 변경을 버린다. MCP에서도 같은 결과를
응답해야 UI와 서버 명령 결과가 다르지 않다.

재생 위치와 타임라인 보기 범위는 프로젝트 저장 대상이 아니다. `seek` 도구는
현재 video element의 `currentTime`만 바꾸고 undo checkpoint를 만들지 않는다.
타임라인 range 변경도 MCP resource로 노출할 수는 있지만 저장/내보내기에 영향을
주지 않는 editor UI state로 표시해야 한다.

트림과 속도는 preview와 export 양쪽에 연결된다. preview에서는
`createVideoEventHandlers`가 재생 중 trim 구간에 들어가면 end로 skip하고, 활성
speed region이 있으면 `video.playbackRate`를 변경한다. export에서는
`StreamingVideoDecoder.getExportMetrics`와 `decodeAll`이 `trimRegions`와
`speedRegions`를 받아 frame count와 source timestamp를 계산한다.

줌 자동 추천은 cursor telemetry에 의존한다. `VideoEditor`가
`electronAPI.getCursorTelemetry`로 samples/clicks를 로드하고, `TimelineEditor`가
`detectZoomDwellCandidates` 결과를 기존 zoom span과 겹치지 않는 빈 구간에 넣는다.
MCP에서 `zoom.suggest`를 제공할 때도 telemetry가 없거나 usable sample이 부족하면
명확한 no-op 결과를 반환해야 한다.

키프레임은 현재 `TimelineEditor` local state만 변경한다. playhead snap 보조에는
쓰이지만 `ProjectEditorState`, preview renderer, exporter 입력에 포함되지 않는다.
MCP에는 임시 timeline marker로만 노출하고 project save 결과에 포함시키지 않는다.

## 제약과 검증

- time 값은 millisecond integer로 반올림하고 `0..durationMs` 안으로 clamp한다.
- span은 `endMs > startMs`를 보장하고 UI 최소 길이와 영상 길이를 적용한다.
- zoom depth는 `1..6`, focus mode는 `manual` 또는 `auto`, rotation preset은
  `iso`, `left`, `right`, `null`만 허용한다.
- speed preset 외 custom speed도 가능하지만 내부 범위는 `0.1..16`이다.
- annotations와 blur는 overlap 허용, zoom/trim/speed는 같은 종류 내 overlap 금지.
- region 삭제 시 해당 selection id도 null로 정리해야 한다.
- keyframe은 저장/내보내기 비반영 상태임을 MCP 응답에 표시한다.
