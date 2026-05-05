# MCP 편집 가이드와 시나리오 작성 규칙

이 문서는 OpenScreen MCP 서버를 통해 녹화본이나 기존 동영상을 자동 편집할 때
시나리오 작성자와 MCP 실행자가 함께 따라야 하는 가이드이다. 목적은 사용자의
막연한 편집 의도를 바로 도구 호출로 보내지 않고, 먼저 검증 가능한 편집
시나리오로 정리한 뒤 OpenScreen MCP 도구로 실행하는 것이다.

## 역할

| 역할 | 입력 | 출력 |
| --- | --- | --- |
| 시나리오 작성자 | 이 가이드, 영상 목적, 원본 영상/녹화 맥락, 전사/타임스탬프, 편집 방향 | `MCP Edit Scenario` 문서 또는 JSON |
| MCP 실행자 | 편집 시나리오, 이 가이드, OpenScreen MCP resources/tools | 프로젝트 편집, 저장, 선택적 내보내기 |
| 사용자 | 편집 목적, 대상 시청자, 강조할 장면, 금지 사항, 산출 형식 | 승인 또는 추가 맥락 |

## 전체 흐름

1. 동영상을 생성하거나 녹화할 때 편집 방향을 함께 기록한다.
2. 시나리오 작성자에게 이 문서와 원본 영상 맥락을 전달한다.
3. 시나리오 작성자는 절대 시간 기준의 편집 시나리오를 작성한다.
4. MCP 실행자는 `openscreen://editing/guide`와 관련 기능 문서를 읽는다.
5. MCP 실행자는 현재 프로젝트와 편집 상태를 조회한다.
6. MCP 실행자는 시나리오의 operation을 OpenScreen MCP tool call로 순서대로 적용한다.
7. 변경 후 프로젝트를 저장하고, 요청이 있을 때만 export를 실행한다.
8. MCP 실행자는 적용 결과와 남은 확인 사항을 사용자에게 보고한다.

## 시나리오 작성자에게 전달할 입력

시나리오 작성자는 다음 정보를 받아야 한다. 정보가 없으면 추정하지 말고
`openQuestions`에 남긴다.

| 항목 | 설명 | 예시 |
| --- | --- | --- |
| `projectGoal` | 영상의 목적 | 제품 기능 데모, 튜토리얼, 버그 재현, 릴스 |
| `targetAudience` | 시청자 | 신규 사용자, 내부 QA, 개발자, 고객 |
| `editingDirection` | 톤과 편집 원칙 | 빠른 템포, 설명 중심, 클릭 강조, 민감 정보 블러 |
| `sourceMaterial` | 원본 정보 | duration, 해상도, 녹화 종류, webcam/audio 여부 |
| `timelineEvidence` | 장면 근거 | transcript, chapter, cursor/click event, user note |
| `mustKeep` | 반드시 유지할 구간 | 핵심 설명, 성공 결과 화면 |
| `mustRemove` | 제거할 구간 | 대기 시간, 실수, 개인정보 노출 |
| `visualPolicy` | 화면 처리 규칙 | crop, zoom, cursor highlight, blur, annotation |
| `exportPolicy` | 산출 규칙 | MP4/GIF, 품질, 반복 여부 |

권장 입력 형식:

```json
{
	"projectGoal": "OpenScreen의 MCP 편집 기능 데모",
	"targetAudience": "개발자와 영상 제작자",
	"editingDirection": {
		"pace": "compact",
		"tone": "clear tutorial",
		"focus": ["important clicks", "before/after result"],
		"avoid": ["unnecessary waiting", "personal information"]
	},
	"sourceMaterial": {
		"durationMs": 180000,
		"hasWebcam": false,
		"hasCursorTelemetry": true,
		"transcriptAvailable": true
	},
	"timelineEvidence": [
		{
			"startMs": 12000,
			"endMs": 26000,
			"note": "MCP console setup explanation"
		}
	],
	"exportPolicy": {
		"format": "mp4",
		"quality": "good"
	}
}
```

## MCP Edit Scenario 형식

시나리오는 실행 가능한 문서여야 한다. 자연어 설명만 쓰지 말고, 각 편집 의도를
타임라인과 MCP operation으로 분해한다.

```json
{
	"scenarioVersion": "openscreen-edit-scenario/v1",
	"title": "MCP 기반 편집 데모",
	"language": "ko-KR",
	"sourceAssumptions": {
		"durationMs": 180000,
		"timestampsAreAbsolute": true,
		"needsHumanReview": false
	},
	"editingDirection": {
		"summary": "설정 과정은 빠르게 보여주고 MCP 실행 결과를 강조한다.",
		"pace": "compact",
		"visualPriorities": ["zoom on CLI commands", "cursor highlight", "privacy blur"]
	},
	"globalOperations": [
		{
			"id": "global-001",
			"tool": "openscreen.layout.setAspectRatio",
			"arguments": {
				"aspectRatio": "16:9"
			},
			"reason": "튜토리얼 영상의 기본 화면 비율을 정리한다."
		},
		{
			"id": "global-002",
			"tool": "openscreen.effects.set",
			"arguments": {
				"padding": 8,
				"borderRadius": 12
			},
			"reason": "화면 가장자리와 여백을 일정하게 맞춘다."
		}
	],
	"timelinePlan": [
		{
			"id": "scene-001",
			"timeRangeMs": {
				"startMs": 12000,
				"endMs": 26000
			},
			"intent": "CLI에서 MCP 서버 설정을 보여준다.",
			"operations": [
				{
					"id": "op-001",
					"tool": "openscreen.timeline.zoom.add",
					"arguments": {
						"startMs": 12000,
						"endMs": 26000,
						"durationMs": 180000,
						"depth": 3,
						"focusMode": "manual",
						"focus": {
							"cx": 0.5,
							"cy": 0.58
						}
					},
					"reason": "터미널 명령 입력 영역을 확대한다."
				}
			]
		}
	],
	"exportPlan": {
		"shouldExport": true,
		"format": "mp4",
		"quality": "good"
	},
	"validationChecklist": [
		"모든 timeRangeMs가 source duration 안에 있다.",
		"개인정보가 보이는 구간에는 blur operation이 있다.",
		"export 전에 project save를 호출한다."
	],
	"openQuestions": []
}
```

## 작성 규칙

- 시간 값은 모두 millisecond integer로 쓴다.
- `startMs`와 `endMs`는 원본 영상 기준의 절대 시간으로 쓴다.
- 알 수 없는 시간은 임의로 만들지 말고 `openQuestions`에 남긴다.
- zoom, trim, speed 구간은 같은 종류끼리 겹치지 않게 작성한다.
- annotation과 blur는 겹칠 수 있지만, z-order가 중요하면 이유를 쓴다.
- 민감 정보, 계정 정보, 토큰, 이메일, URL query, 개인 이름은 blur 대상으로 표시한다.
- 반복 대기, 로딩, 실수, 무음 구간은 trim 후보로 표시한다.
- 명령 입력, 버튼 클릭, 결과 변화는 zoom 또는 cursor highlight 후보로 표시한다.
- 산출물이 튜토리얼이면 핵심 단계마다 짧은 annotation을 쓸 수 있다.
- export는 사용자가 요청했거나 `exportPolicy`가 있을 때만 시나리오에 포함한다.
- 한 operation은 하나의 명확한 변경만 담당한다.
- operation마다 `reason`을 적어 나중에 사람이 검토할 수 있게 한다.

## MCP 실행 규칙

MCP 실행자는 시나리오를 적용하기 전에 다음 순서로 상태를 확인한다.

1. `openscreen://app/status`를 읽어 MCP 서버와 editor window 상태를 확인한다.
2. `openscreen://project/current` 또는 `openscreen.project.current`를 읽는다.
3. `openscreen://editor/state` 또는 `openscreen.timeline.state`를 읽어 duration과 기존 region을 확인한다.
4. `openscreen://editing/feature-index`와 관련 기능 문서를 확인한다.
5. 시나리오의 operation을 순서대로 실행한다.
6. 변경 후 `openscreen.project.snapshot`으로 결과를 확인한다.
7. `openscreen.project.save`를 호출한다.
8. `exportPlan.shouldExport`가 true일 때만 export 설정과 export 시작을 실행한다.

실행 중 MCP tool이 실패하면 다음 operation으로 넘어가기 전에 실패 원인을 기록한다.
시간 범위 충돌, duration 불일치, 지원되지 않는 옵션처럼 자동 복구가 위험한 경우는
사용자 확인을 받아야 한다.

## 기능 문서 매핑

| 편집 영역 | MCP resource |
| --- | --- |
| 녹화 소스, HUD, 입력 장치 | `openscreen://editing/features/recording-hud-and-source` |
| 프로젝트와 미디어 | `openscreen://editing/features/project-and-media` |
| zoom, trim, speed, timeline region | `openscreen://editing/features/timeline-editing` |
| preview에서 직접 위치/크기 조정 | `openscreen://editing/features/preview-direct-editing` |
| 화면 비율, 배경, padding, shadow | `openscreen://editing/features/layout-effects-background` |
| crop | `openscreen://editing/features/crop-editing` |
| cursor highlight | `openscreen://editing/features/cursor-highlight` |
| text/image/arrow annotation | `openscreen://editing/features/annotation-editing` |
| blur, mosaic | `openscreen://editing/features/blur-and-mosaic` |
| MP4/GIF export | `openscreen://editing/features/export-settings` |
| shortcuts, preferences, language | `openscreen://editing/features/shortcuts-preferences-language` |

## MCP 실행 요청 템플릿

아래 템플릿은 시나리오와 함께 MCP 실행자에게 전달할 수 있다.

```text
OpenScreen MCP endpoint: http://127.0.0.1:18888/mcp

Read resources first:
- openscreen://editing/guide
- openscreen://editing/feature-index
- openscreen://app/status
- openscreen://project/current
- openscreen://editor/state

Apply this MCP Edit Scenario exactly where possible.
Use the referenced openscreen://editing/features/... documents before calling mutating tools.
Do not invent timestamps or overwrite unrelated project state.
Save the project after successful changes.
Run export only when exportPlan.shouldExport is true.

<PASTE_MCP_EDIT_SCENARIO_HERE>
```

## 검증 체크리스트

- 시나리오에 `scenarioVersion`이 있다.
- 모든 timeline operation에 `startMs`, `endMs`, `durationMs` 중 필요한 값이 있다.
- 모든 operation에 `tool`, `arguments`, `reason`이 있다.
- 기존 project state와 충돌할 수 있는 region overlap이 검토되었다.
- 민감 정보 처리 계획이 있다.
- export 실행 여부가 명시되어 있다.
- 사용자 확인이 필요한 항목은 `openQuestions`에 남아 있다.
