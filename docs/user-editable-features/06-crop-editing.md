# 크롭 편집 MCP 연동 분석

## 포함 기능

- 크롭 영역 드래그
- 크롭 영역 리사이즈
- 픽셀 입력: `X`, `Y`, `W`, `H`
- 비율 프리셋: 자유, `16:9`, `9:16`, `4:3`, `3:4`, `1:1`, `21:9`
- 비율 잠금/해제
- 취소/완료

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| crop modal/settings | `src/components/video-editor/SettingsPanel.tsx` | crop modal 열기, snapshot/cancel, pixel input, ratio preset |
| crop overlay | `src/components/video-editor/CropControl.tsx` | canvas preview, drag/resize handle |
| 편집 state | `src/hooks/useEditorHistory.ts` | `cropRegion` 저장 |
| project normalize | `src/components/video-editor/projectPersistence.ts` | `cropRegion` clamp |
| preview/export | `VideoPlayback.tsx`, `src/lib/exporter/frameRenderer.ts` | source crop area 반영 |

## 상태 모델

`cropRegion`은 원본 영상 기준 normalized 좌표이다.

```ts
interface CropRegion {
  x: number;      // 0..1
  y: number;      // 0..1
  width: number;  // 0..1
  height: number; // 0..1
}
```

UI의 pixel input은 video element의 `videoWidth`/`videoHeight`로 변환된다.
`SettingsPanel.handleCropNumericChange`는 입력 pixel 값을 normalized 값으로 바꾸고
`onCropChange`를 호출한다. `CropControl`의 drag/resize도 container 좌표를
normalized 값으로 변환한다.

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.crop.get` | resource | `editorState.cropRegion`, source video dimensions | pixel 값도 함께 계산 가능 |
| `openscreen.crop.setNormalized` | tool | `pushState({ cropRegion })` | canonical API |
| `openscreen.crop.setPixels` | tool | video dimensions로 normalize 후 `pushState` | video metadata 필요 |
| `openscreen.crop.applyAspectPreset` | tool | `SettingsPanel.applyCropAspectPreset`와 동일 계산 | crop aspect lock은 UI 임시 state |
| `openscreen.crop.reset` | tool | `DEFAULT_CROP_REGION` 적용 | full frame |

## MCP 상호 작용 설계

MCP에서는 normalized crop을 canonical 입력으로 삼는 것이 가장 안전하다. pixel
입력 도구는 현재 video metadata가 로드된 경우에만 제공하고, `videoWidth`와
`videoHeight`가 없으면 오류를 반환해야 한다. pixel 입력 값은 현재 UI처럼 source
dimension으로 나누어 `cropRegion`으로 저장한다.

비율 프리셋과 비율 잠금은 현재 modal 내부 local state이다. 프로젝트에는 잠금
상태나 선택 프리셋이 저장되지 않고, 적용 결과인 `cropRegion`만 저장된다. MCP
tool은 "비율 잠금 상태를 저장"하는 도구를 제공하지 않고, `applyAspectPreset`처럼
현재 crop box를 지정 ratio에 맞춰 조정하는 stateless tool로 모델링하는 편이
현재 구현과 맞다.

취소/완료도 modal UI state이다. `SettingsPanel`은 modal을 열 때
`cropSnapshotRef`에 이전 crop을 복사하고, modal 밖 클릭/닫기에서 snapshot을
복원한다. MCP에는 interactive modal 개념이 없으므로, 여러 crop 변경을 하나의
transaction으로 묶고 취소 시 이전 crop을 다시 적용하는 command protocol을 둘 수
있다. 단순 tool은 호출 즉시 `cropRegion`을 적용하고 undo history에 남기는 것으로
충분하다.

## 제약과 검증

- `x`, `y`는 `0..1`, `width`, `height`는 최소 `0.01` 이상으로 보정한다.
- `x + width <= 1`, `y + height <= 1`을 보장한다.
- UI drag resize의 최소 크기는 `0.1`이고 project normalize의 최소 크기는 `0.01`이다.
- pixel input tool은 video metadata가 없는 상태에서는 실행하지 않는다.
- crop은 preview, native aspect ratio 계산, MP4/GIF export에 모두 반영된다.
