# 사용자 편집 기능 MCP 연동 분석

이 문서는 기존 단일 명세를 세부 기능 문서로 분리한 목차이다. 각 세부 문서는
OpenScreen의 현재 코드 흐름을 기준으로, 해당 기능을 MCP server 도구/리소스로
노출할 때 어떤 상태와 IPC, 렌더러 핸들러, 저장/내보내기 경로가 상호 작용해야
하는지 분석한다.

MCP로 실제 편집을 수행할 때는 먼저
[MCP 편집 가이드와 시나리오 작성 규칙](mcp-editing-guide.md)을 시나리오 작성자와
MCP 실행자에게 전달한다. 이 가이드는 원본 영상 맥락을 `MCP Edit Scenario`로
정리하고, 아래 기능 문서를 참조해 tool call 순서로 변환하는 규칙을 정의한다.
MCP 클라이언트는 `openscreen://editing/guide`,
`openscreen://editing/feature-index`, `openscreen://editing/features/...` 리소스로
같은 문서를 읽을 수 있다.

## 공통 연동 모델

OpenScreen의 편집 가능 상태는 대부분 렌더러의 `VideoEditor`와
`useEditorHistory` 안에 있다. Electron main process는 파일 접근, 녹화 세션,
프로젝트 저장/불러오기, 단축키 저장, 플랫폼 권한 같은 OS 경계만 담당한다.
따라서 MCP server를 붙일 때는 main process에서 React state를 직접 고치기보다
렌더러에 명령을 전달하는 command/controller 계층을 두고, 그 계층이 기존
핸들러(`pushState`, `updateState`, `commitState`, `window.electronAPI.*`)를
호출하도록 설계해야 한다.

권장 MCP 표면은 다음 세 가지로 나눈다.

| 유형 | 역할 | 코드 경계 |
| --- | --- | --- |
| `resources` | 현재 프로젝트/편집 상태, 미디어 경로, 커서 텔레메트리, 지원 옵션 조회 | `VideoEditor`, `projectPersistence`, `electron/ipc/handlers.ts` |
| `tools` | 녹화 제어, 소스 선택, 편집 상태 변경, 저장/내보내기 실행 | 렌더러 command 계층, 기존 `electronAPI` IPC |
| `prompts` | 사용자 확인이 필요한 저장/덮어쓰기/권한 요청 시나리오 안내 | Electron dialog/permission 흐름 |

공통 원칙:

- 프로젝트에 저장되는 값은 `ProjectEditorState`와 `normalizeProjectEditor`를
  기준으로 검증한다.
- 단발 변경은 `pushState`로 undo checkpoint를 만들고, 드래그/슬라이더 같은
  연속 변경은 `updateState` 후 `commitState`를 호출한다.
- 파일 경로 읽기/쓰기, 프로젝트 로드, 내보내기 저장 위치 선택은 기존
  `electron/ipc/handlers.ts`의 승인 경계를 재사용한다.
- 현재 재생 시간, 선택 ID, 전체화면, 타임라인 보기 범위, 키프레임은 프로젝트에
  저장되지 않는 임시 상태로 취급한다.

## 세부 문서

| 문서 | 포함 기능 |
| --- | --- |
| [01-recording-hud-and-source.md](user-editable-features/01-recording-hud-and-source.md) | 녹화 HUD, 소스 선택, 시스템 오디오, 마이크, 웹캠, 녹화 상태, 기존 영상/프로젝트 열기, HUD 언어 |
| [02-project-and-media.md](user-editable-features/02-project-and-media.md) | 프로젝트 저장/불러오기, 새 녹화, 저장되지 않은 변경 추적, 프로젝트 스키마, 미디어 경로 승인 |
| [03-timeline-editing.md](user-editable-features/03-timeline-editing.md) | 재생 위치, 타임라인 보기, 줌/트림/속도/주석/블러 구간, 키프레임 |
| [04-preview-direct-editing.md](user-editable-features/04-preview-direct-editing.md) | 줌 초점 드래그, 웹캠 PiP 위치, 주석/블러 위치와 크기, 자유형 블러 경로, 전체화면 미리보기 |
| [05-layout-effects-background.md](user-editable-features/05-layout-effects-background.md) | 종횡비, 웹캠 레이아웃/마스크/크기, 배경 블러, 모션 블러, 그림자, 둥근 모서리, 여백, 배경 이미지/색/그라디언트 |
| [06-crop-editing.md](user-editable-features/06-crop-editing.md) | 크롭 드래그/리사이즈, 픽셀 입력, 비율 프리셋, 비율 잠금, 취소/완료 |
| [07-cursor-highlight.md](user-editable-features/07-cursor-highlight.md) | 커서 하이라이트 사용 여부, 스타일, 크기, 색상, 클릭 시 표시, 오프셋 |
| [08-annotation-editing.md](user-editable-features/08-annotation-editing.md) | 텍스트/이미지/화살표 주석, 사용자 글꼴, 복제, 삭제 |
| [09-blur-and-mosaic.md](user-editable-features/09-blur-and-mosaic.md) | 블러/모자이크 타입, 모양, 색상, 강도/블록 크기, 삭제 |
| [10-export-settings.md](user-editable-features/10-export-settings.md) | MP4/GIF 내보내기 형식, 품질, GIF FPS/크기/반복, 저장 위치, 취소, 폴더에서 보기 |
| [11-shortcuts-preferences-language.md](user-editable-features/11-shortcuts-preferences-language.md) | 편집 단축키, 고정 단축키, 사용자 기본 설정, 사용자 글꼴 저장, 언어 저장 |

## 완료 감사 체크리스트

### 요청 대비 산출물

| 요청 사항 | 산출물/근거 |
| --- | --- |
| 현재 프로젝트 기능을 MCP server로 연동할 때의 상호 작용을 코드 레벨에서 분석 | 각 세부 문서의 `현재 코드 경로`, `MCP tool/resource 후보`, `MCP 상호 작용 설계`, `제약과 검증` 섹션 |
| `docs/user-editable-features.md`의 기능을 세부 기능 파일로 분리 | `docs/user-editable-features/01-...md`부터 `11-...md`까지 11개 문서 |
| 모든 세부 기능 문서에 분석 결과 업데이트 | 모든 세부 문서가 코드 경로, 상태/스키마, MCP 도구 후보, 상호작용 설계, 제약/검증을 포함 |
| 누락된 분석 결과가 없을 때까지 반복 감사 | 아래 원 명세 영역별 대응표와 키워드 기반 문서 확인으로 점검 |

### 원 명세 영역별 대응

| 원 명세 영역 | 분리 문서 | 감사 결과 |
| --- | --- | --- |
| 주요 진입점 | 01, 02, 03, 05, 08, 09, 11 | 반영 |
| 녹화 전 설정 및 입력 선택 | 01, 11 | 반영 |
| 프로젝트 및 미디어 관리 | 02 | 반영 |
| 프로젝트 파일 저장 필드 | 02 및 관련 기능 문서 | 반영 |
| 타임라인 편집 | 03 | 반영 |
| 캔버스 및 미리보기 직접 편집 | 04 | 반영 |
| 화면 구성, 효과, 배경 | 05 | 반영 |
| 크롭 편집 | 06 | 반영 |
| 커서 하이라이트 | 07 | 반영 |
| 주석 편집 | 08 | 반영 |
| 블러 및 모자이크 편집 | 09 | 반영 |
| 내보내기 설정 | 10 | 반영 |
| 단축키와 개인 설정 | 11 | 반영 |
| 저장되지 않는 임시 상태 | 03, 04, 11 | 반영 |
