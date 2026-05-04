# 주석 편집 MCP 연동 분석

## 포함 기능

- 텍스트 주석: 내용, 글꼴, 크기, 굵게, 기울임, 밑줄, 정렬, 글자색, 배경색
- 텍스트 글꼴: 기본 프리셋, 사용자 글꼴
- 사용자 글꼴: Google Fonts `@import` URL, 표시 이름
- 이미지 주석: 이미지 파일 업로드
- 화살표 주석: 방향, 선 두께, 색상
- 복제
- 삭제

## 현재 코드 경로

| 영역 | 파일 | 역할 |
| --- | --- | --- |
| 설정 패널 | `src/components/video-editor/AnnotationSettingsPanel.tsx` | 텍스트/이미지/화살표 상세 편집 |
| overlay | `src/components/video-editor/AnnotationOverlay.tsx` | 미리보기 위치/크기/렌더 |
| 편집 state owner | `src/components/video-editor/VideoEditor.tsx` | add/type/content/style/figure/duplicate/delete handler |
| 타입 | `src/components/video-editor/types.ts` | `AnnotationRegion`, style, figure data |
| 사용자 글꼴 | `src/lib/customFonts.ts`, `src/components/video-editor/AddCustomFontDialog.tsx` | Google Fonts 검증/로드/저장 |
| export render | `src/lib/exporter/annotationRenderer.ts` | canvas에 annotation 렌더 |

## 저장 모델

모든 주석은 `annotationRegions` 배열에 저장된다. 블러도 같은 배열을 쓰지만
`type: "blur"`인 항목은 별도 문서에서 다룬다.

| 필드 | 의미 |
| --- | --- |
| `id` | `annotation-N` 형태 |
| `startMs`, `endMs` | 표시 시간 구간 |
| `type` | `text`, `image`, `figure`, `blur` |
| `content` | 현재 타입의 legacy content |
| `textContent`, `imageContent` | 타입 전환 시 보존용 content |
| `position` | overlay 기준 `{ x, y }` percent |
| `size` | overlay 기준 `{ width, height }` percent |
| `style` | text style 전체 |
| `zIndex` | 겹침/선택 순서 |
| `figureData` | arrow direction/color/stroke width |

## MCP tool/resource 후보

| MCP 이름 | 종류 | 내부 호출/구현 경계 | 비고 |
| --- | --- | --- | --- |
| `openscreen.annotations.list` | resource | `annotationRegions.filter(type !== "blur")` | blur 제외 |
| `openscreen.annotations.add` | tool | `handleAnnotationAdded` | 기본 text 주석 생성 |
| `openscreen.annotations.setType` | tool | `handleAnnotationTypeChange` | text/image/figure |
| `openscreen.annotations.setContent` | tool | `handleAnnotationContentChange` | type별 content 보존 |
| `openscreen.annotations.setStyle` | tool | `handleAnnotationStyleChange` | partial style merge |
| `openscreen.annotations.setFigure` | tool | `handleAnnotationFigureDataChange` | arrow 전용 |
| `openscreen.annotations.duplicate` | tool | `handleAnnotationDuplicate` | position +4%, zIndex 증가 |
| `openscreen.annotations.delete` | tool | `handleAnnotationDelete` | selection 정리 |
| `openscreen.customFonts.list` | resource | `getCustomFonts` | localStorage |
| `openscreen.customFonts.add` | tool | `addCustomFont` | Google Fonts URL만 |
| `openscreen.customFonts.remove` | tool | `removeCustomFont` | style element 제거 |

## MCP 상호 작용 설계

주석은 시간 구간과 화면 overlay 값을 모두 가진다. MCP에서 주석을 추가하려면 먼저
timeline span을 결정하고 `handleAnnotationAdded` 흐름을 재사용해 id와 zIndex를
생성한다. 그 다음 필요하면 type/content/style tool을 연속 호출하거나 batch
command로 한 번에 적용한다. batch command를 만들 경우 `pushState`를 한 번만
호출해 undo checkpoint가 하나만 생기도록 하는 것이 좋다.

타입 전환에는 content 보존 로직이 있다. `handleAnnotationTypeChange`는 text로
바꿀 때 `textContent || "Enter text..."`, image로 바꿀 때 `imageContent || ""`를
사용하고, figure로 바꾸면 `figureData`가 없을 때 기본값을 넣는다. MCP가 type만
직접 변경하면 이 보존 로직이 빠질 수 있으므로 반드시 기존 handler와 같은 변환을
적용해야 한다.

이미지 주석 업로드는 renderer의 `FileReader`가 data URL을 만들고 `content`에
저장한다. MCP가 파일 경로를 받아 이미지 주석을 만들려면 main process의 파일 승인
정책이 필요하다. 현재 UI와 맞추려면 MCP 입력은 data URL 또는 사용자가 승인한
파일 선택 결과로 제한한다. 허용 MIME은 JPEG/JPG/PNG/GIF/WEBP이다.

사용자 글꼴은 project가 아니라 localStorage의 `openscreen_custom_fonts`에 저장된다.
`addCustomFont`는 `fonts.googleapis.com` URL인지 검증하고, 실제 font load를
확인한 뒤 저장한다. MCP tool은 URL 파싱(`parseFontFamilyFromImport`)과
`loadFont` 실패를 사용자에게 반환해야 한다. project에는 선택된 주석의
`style.fontFamily` 문자열만 저장된다.

복제는 원본 annotation을 복사하되 id와 zIndex를 새로 만들고 position x/y를 각각
4% 이동한다. image data URL이나 style/figureData도 복사된다. MCP에서도 동일한
결과를 반환하면 UI와 일관된다.

## 제약과 검증

- text style은 `fontWeight`, `fontStyle`, `textDecoration`, `textAlign`의 허용값만
  받는다.
- font size UI는 `12..128`의 프리셋 값만 노출한다.
- image upload는 JPEG/JPG/PNG/GIF/WEBP만 허용한다.
- arrow direction은 8방향, stroke width는 `1..6`이다.
- annotation position/size는 preview direct editing 문서의 percent 좌표 규칙을 따른다.
- annotation끼리 시간 overlap은 허용한다.
