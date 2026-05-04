# 화면 구성, 효과, 배경 MCP 연동 분석

## 포함 기능

- 종횡비: `16:9`, `9:16`, `1:1`, `4:3`, `4:5`, `16:10`, `10:16`, `native`
- 웹캠 레이아웃: `picture-in-picture`, `vertical-stack`, `dual-frame`
- 웹캠 모양: `rectangle`, `circle`, `square`, `rounded`
- 웹캠 크기: `10%..50%`
- 배경 블러, 모션 블러, 그림자, 모서리 둥글기, 여백
- 배경 이미지, 사용자 JPEG 업로드, 업로드 이미지 제거
- 배경 단색과 그라디언트

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 설정 UI | `src/components/video-editor/SettingsPanel.tsx` | layout/effects/background 컨트롤 |
| 편집 state | `src/hooks/useEditorHistory.ts` | wallpaper, effects, aspect ratio, webcam fields |
| layout 계산 | `src/lib/compositeLayout.ts` | PiP/stack/dual screen/webcam rect 계산 |
| wallpaper 처리 | `src/lib/wallpaper.ts`, `src/lib/exporter/gradientParser.ts` | image/color/gradient 분류와 export 렌더 |
| preview | `src/components/video-editor/VideoPlayback.tsx` | layout/effects preview 적용 |
| export | `src/lib/exporter/frameRenderer.ts` | 동일 state로 offscreen render |
| user prefs | `src/lib/userPreferences.ts` | padding, aspect ratio, export quality/format 기본값 |

## 저장 필드와 의미

| 필드 | 의미 | UI 제약 |
| --- | --- | --- |
| `aspectRatio` | canvas/output 비율 | `native`는 source+crop 기준 |
| `webcamLayoutPreset` | webcam 합성 방식 | portrait는 `vertical-stack`, landscape는 `dual-frame` 노출 |
| `webcamMaskShape` | PiP webcam mask | PiP에서만 변경 가능 |
| `webcamSizePreset` | PiP webcam 크기 percent | `10..50` |
| `webcamPosition` | PiP center | PiP가 아니면 null |
| `showBlur` | 배경 블러 | boolean |
| `motionBlurAmount` | zoom/pan motion blur | `0..1` |
| `shadowIntensity` | screen shadow | `0..1` UI |
| `borderRadius` | screen clip radius | `0..16px` UI |
| `padding` | canvas inner padding | `0..100`, `vertical-stack`에서 비활성 |
| `wallpaper` | image/color/gradient/data URL | JPEG upload data URL 가능 |

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.layout.getOptions` | resource | `ASPECT_RATIOS`, `WEBCAM_LAYOUT_PRESETS`, mask shapes | 현재 aspect에 따른 허용 layout 포함 |
| `openscreen.layout.setAspectRatio` | tool | `pushState({ aspectRatio, webcamLayoutPreset })` | 호환 안 되는 webcam layout은 PiP로 되돌림 |
| `openscreen.layout.setWebcamLayout` | tool | `pushState({ webcamLayoutPreset, webcamPosition })` | PiP가 아니면 position null |
| `openscreen.layout.setWebcamMask` | tool | `pushState({ webcamMaskShape })` | PiP only |
| `openscreen.layout.setWebcamSize` | tool | `updateState` + `commitState` | slider 성격 |
| `openscreen.effects.set` | tool | `pushState` 또는 slider는 `updateState`/`commitState` | blur/shadow/motion/radius/padding |
| `openscreen.background.set` | tool | `pushState({ wallpaper })` | image path, data URL, color, gradient |
| `openscreen.background.uploadImage` | tool | renderer FileReader 또는 승인된 data URL 입력 | 현재 UI는 JPEG만 허용 |

## MCP 상호 작용 설계

종횡비 변경은 webcam layout과 함께 처리해야 한다. `VideoEditor`는 타임라인의
aspect ratio 변경 callback에서 현재 layout이 새 canvas 방향과 호환되지 않으면
`webcamLayoutPreset`을 `picture-in-picture`로 바꾼다. MCP의 aspect ratio tool도
같은 규칙을 적용해야 `vertical-stack`이 landscape에 남거나 `dual-frame`이
portrait에 남는 불일치를 막을 수 있다.

웹캠 layout은 `computeCompositeLayout`이 preview와 export 양쪽에서 공유하는 핵심
계산이다. PiP는 `webcamPosition`과 `webcamSizePreset`을 사용하고, stack/split은
preset 정의로 screen/webcam rect를 계산한다. MCP tool은 webcam media가 없는
상태에서도 layout 값을 저장할 수는 있지만 preview/export에서는 webcam rect가
null이 된다. 사용자 의도 확인을 위해 resource 응답에 `hasWebcam`을 포함하는 것이
좋다.

효과 슬라이더는 현재 UI에서 live update 후 commit하는 패턴이다. shadow,
motion blur, border radius, padding, webcam size는 MCP에서도 batch 변경을
지원하되, 단일 undo checkpoint를 원하면 `updateState`로 여러 값을 바꾸고 마지막에
`commitState`를 호출하는 command를 둔다.

배경은 `classifyWallpaper`가 CSS color, gradient, image path를 분류하고
preview/export가 각각 DOM/Pixi 또는 canvas로 렌더한다. 기본 wallpaper는
canonical `/wallpapers/wallpaperN.jpg` path로 저장해야 하며, dev/package의
machine-specific `file://` URL은 프로젝트 저장 값으로 남기지 않는다. 사용자 업로드
JPEG는 data URL을 `wallpaper`에 바로 저장할 수 있지만, UI 패널의 업로드 이미지
목록(`customImages`)은 project에 저장되지 않는다.

## 제약과 검증

- aspect ratio는 `ASPECT_RATIOS`의 값만 허용한다.
- `native` export ratio는 source video와 `cropRegion` 기준으로 계산한다.
- PiP가 아닌 layout으로 바뀌면 `webcamPosition`을 null 처리한다.
- `vertical-stack`에서는 padding을 적용하지 않는 UI 동작을 명시한다.
- wallpaper 값은 color/gradient/image/data URL 중 하나로 분류 가능해야 한다.
- 사용자 background upload는 현재 UI 기준 JPEG/JPG만 허용한다.
- preview와 export 모두 같은 state를 받으므로 MCP 변경 후 export parameter에도
  자동 반영되어야 한다.
