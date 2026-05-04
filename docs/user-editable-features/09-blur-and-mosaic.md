# 블러 및 모자이크 편집 MCP 연동 분석

## 포함 기능

- 블러 모양: 사각형, 타원
- 숨은/스키마 지원 모양: 자유형
- 블러 타입: 블러, 모자이크
- 오버레이 색상: 흰색, 검은색
- 블러 강도: `2px..40px`
- 모자이크 블록 크기: `4px..48px`
- 위치와 크기
- 삭제

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 설정 패널 | `src/components/video-editor/BlurSettingsPanel.tsx` | shape/type/color/intensity/block size/delete |
| overlay | `src/components/video-editor/AnnotationOverlay.tsx` | blur/mosaic preview, freehand drawing |
| blur helpers | `src/lib/blurEffects.ts` | type/color/block size normalize와 overlay color |
| 편집 state owner | `src/components/video-editor/VideoEditor.tsx` | `handleBlurAdded`, blur data preview/panel change |
| 타입/기본값 | `src/components/video-editor/types.ts` | `BlurData`, intensity/block size range |
| export render | `src/lib/exporter/annotationRenderer.ts` | blur/mosaic annotation 렌더 |

## 저장 모델

블러는 `annotationRegions` 안의 `type: "blur"` annotation이다.

```ts
interface BlurData {
  type: "blur" | "mosaic";
  shape: "rectangle" | "oval" | "freehand";
  color: "white" | "black";
  intensity: number;
  blockSize: number;
  freehandPoints?: Array<{ x: number; y: number }>;
}
```

기본값은 blur/rectangle/white, intensity `12`, block size `12`,
freehand 기본 path이다. project normalize는 shape/type/color와 숫자 범위를 보정한다.

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.blurs.list` | resource | `annotationRegions.filter(type === "blur")` | blur only |
| `openscreen.blurs.add` | tool | `handleBlurAdded` | 기본 blur annotation 생성 |
| `openscreen.blurs.setData` | tool | `handleBlurDataPanelChange` | panel style commit |
| `openscreen.blurs.previewData` | tool | `handleBlurDataPreviewChange` + optional commit | freehand/live preview |
| `openscreen.blurs.setBounds` | tool | annotation position/size handler | rectangle/oval |
| `openscreen.blurs.delete` | tool | `handleAnnotationDelete` | selection 정리 |

## MCP 상호 작용 설계

블러는 annotation과 같은 timeline/overlay lifecycle을 공유한다. 시간 구간은
timeline 문서의 region span 규칙을 따르고, 위치/크기는 preview direct editing
문서의 percent 좌표 규칙을 따른다. MCP `blurs.add`는 `handleBlurAdded`와 같은
기본값을 생성해야 하며, id는 annotation id sequence를 공유한다.

설정 패널에서 shape/type/color를 바꾸면 `onBlurDataChange` 후
`requestAnimationFrame`으로 commit callback을 호출한다. intensity/block slider는
drag 중 변경하고 commit 시 history dirty flag를 닫는다. MCP가 단일 setData를
수행할 때는 `pushState`로 충분하지만, freehand drawing이나 slider streaming을
지원한다면 `previewData`와 `commit`을 분리하는 편이 UI history와 맞다.

자유형 blur는 schema와 renderer/exporter가 지원하지만 현재 `BlurSettingsPanel`은
rectangle/oval만 보여준다. MCP에서 freehand를 노출하려면 UI보다 넓은 기능을 여는
것이므로 문서화된 advanced 기능으로 표시해야 한다. shape가 `freehand`가 되면
현재 `VideoEditor`는 position `{ x: 0, y: 0 }`, size `{ width: 100, height: 100 }`로
맞춘다. 이 동작은 MCP에서도 유지해야 preview/export의 path 좌표가 일관된다.

모자이크는 preview에서 source canvas 일부를 downscale하고 `imageRendering:
pixelated`로 표시한다. export는 canvas renderer에서 같은 block size를 사용한다.
따라서 MCP 도구는 `type: "mosaic"`일 때 `blockSize`, `type: "blur"`일 때
`intensity`가 의미 있음을 응답 schema에 명시해야 한다.

## 제약과 검증

- shape는 `rectangle`, `oval`, `freehand`만 저장 가능하지만 UI 노출은
  rectangle/oval이다.
- type은 `blur`, `mosaic`만 허용한다.
- color는 `white`, `black`만 허용한다.
- intensity는 `2..40`, block size는 `4..48`로 clamp한다.
- freehand points는 annotation bounds 기준 `0..100` 좌표이고 최소 3개 point가
  필요하다.
- freehand blur는 resize/drag가 비활성화된다.
