# 가지(branch) AI 기능 통합 설계 문서

> **이 문서의 목적**: 향후 AI 기능을 가지(branch) 프로젝트에 박을 때 사용할 통합 프롬프트, 입출력 JSON 구조, Firebase 흐름, 저장/수락/되돌리기 설계, 비용/보안 위험, 구현 우선순위를 박은 사전 설계.
>
> **현재 단계**: **설계 문서화만**. 실제 AI API 연결·Cloud Functions·DB 필드·UI 버튼·rules 변경은 박지 X.
>
> **출처**:
> - 사용자 v106 세션 (2026-05-16) AI 기능 설계 원본 — `project_branch_ai_design.md` 메모리
> - 사용자 v130 직후 박은 GPT 통합 프롬프트 초안 (텍스트 강도 1·2, 이미지 강도 1·2, 입출력 JSON, HTML 비교, 시스템 프롬프트)
> - 가지 v130까지 실제 코드 구조 (viewer-data.js, viewer-locks.js, storyAnalyzer.js, viewer-edit.js)

---

## 목차

0. [큰 원칙 (사용자 박은 정책 정합)](#0-큰-원칙)
1. [텍스트 AI 강도 1/2 프롬프트](#1-텍스트-ai-프롬프트)
2. [이미지 AI 강도 1/2 프롬프트](#2-이미지-ai-프롬프트)
3. [AI 입력 JSON 구조 (가지 scene 모델 매핑)](#3-ai-입력-json-구조)
4. [AI 출력 JSON 구조](#4-ai-출력-json-구조)
5. [HTML 비교 미리보기 구조](#5-html-비교-미리보기)
6. [Firebase 읽기 경로 — 실제 path](#6-firebase-읽기-경로)
7. [저장/수락/되돌리기 설계](#7-저장수락되돌리기-설계)
8. [비용/보안/API key/Cloud Functions/quota 위험](#8-비용보안-위험)
9. [구현 시 필요한 파일 후보](#9-구현-파일-후보)
10. [구현 우선순위](#10-구현-우선순위)
11. [Phase 0 결정문 (구현 전 사용자 결정 박을 자리)](#11-phase-0-결정문)

---

## 0. 큰 원칙

### 0-1. 사용자 박은 원본 정책 (v106 세션, 절대 변경 X)

- 작품의 주인은 **학생**. AI는 보조자.
- **즉시 자동 적용 X** — 항상 학생/교사 확인 단계 거침
- 원작의 핵심 의미 변경 X
- **장면 수**, **선택지 의미**, **분기 흐름** 변경 X
- 학생 문체와 의도 최대한 유지
- 강도 1 = "살짝 다듬어준 느낌". 강도 2 = "장면 발전" (다른 작품 박지 X)
- 이미지 AI = 그림책 모드 전용. 강도 1 = 정돈. 강도 2 = 발전 (교체 X)
- **장면 간 시각적 일관성** 매우 중요 (이미지)

### 0-2. 가지 프로젝트 정합 정책

- **본문 줄바꿈 유지** (v127 정책) — `\n\n` 절대 trim X. AI 결과도 줄바꿈 그대로 보존
- **buttons + choiceA/B 호환** — AI가 라벨 수정 시 두 필드 모두 동기화 (viewer-data.js ALLOWED 기준)
- **잠금 박은 상태에서만 적용** — 다른 친구 잠금 박혀있으면 AI 결과 적용 차단
- **Storage 경유** (v113 만원 사건 이후) — 이미지 큰 base64 RTDB 박지 X. Storage URL만 박음
- **공개수업 정책 박을 거** (사용자 명시 박은 거 있음, 메모리 박지 X) — 학생이 직접 박는지 교사 승인인지 결정 필요
- **모바일 텍스트형 통합** — `mobileTextBranch.js` 박힌 모바일 UI에도 AI 진입점 박혀야 함

---

## 1. 텍스트 AI 프롬프트

### 1-1. 공통 시스템 프롬프트

GPT 박은 원본 그대로. 가지 컨텍스트 박은 거 두 줄 추가.

```text
당신은 초등학생이 만든 분기형 이야기 작품을 도와주는 AI 보조자입니다.

이 작품은 일반적인 일직선 글이 아니라, 여러 장면과 선택지가 연결된 "분기형 이야기"입니다.
따라서 한 장면만 보고 고치면 안 됩니다.
반드시 전체 장면 구조, 선택지 흐름, 엔딩, 앞뒤 맥락을 함께 고려해야 합니다.

당신의 역할은 학생 작품을 대신 만드는 것이 아니라, 학생이 만든 작품을 더 잘 보이도록 도와주는 것입니다.

가장 중요한 원칙:

1. 작품의 주인은 학생입니다.
2. AI는 보조자입니다.
3. 원작의 핵심 의미를 바꾸면 안 됩니다.
4. 장면 수를 바꾸면 안 됩니다.
5. 선택지의 의미를 바꾸면 안 됩니다.
6. 분기 흐름을 바꾸면 안 됩니다.
7. 원래 없던 사건, 설정, 캐릭터를 마음대로 추가하면 안 됩니다.
8. 학생의 문체와 의도를 최대한 유지해야 합니다.
9. 수정한 경우, 무엇을 왜 바꾸었는지 설명해야 합니다.
10. 확신이 없으면 크게 바꾸지 말고 "수정 제안"으로만 남겨야 합니다.

입력으로 제공되는 정보:
- 작품 제목 / 작품 설명
- 전체 장면 목록 (id, title, body, choices, isEnding, isTrueEnd)
- 시작 장면(entrySceneId) / 다시 시작점(replaySceneId)
- 루트 분석 결과 (엔딩별 경로)
- 현재 수정 대상 장면(targetSceneId) 또는 작품 전체(scope=wholeProject)

출력:
- 반드시 구조화된 JSON (스키마는 별도 명시)
- 원본 장면 수 / 장면 ID 절대 변경 금지
- 선택지 nextId 변경 금지
- 수정 가능 영역: 장면 본문(body), 장면 제목(title), 선택지 라벨(label)만

가지 프로젝트 추가 정책:
- 본문의 줄바꿈(\n, \n\n)은 학생이 의도적으로 박은 호흡일 수 있습니다. 절대 trim하지 마세요.
- 한 장면이 여러 경로에 반복 등장할 수 있습니다. 같은 sceneId의 수정은 모든 경로에 동일하게 적용됩니다.
```

### 1-2. 강도 1 — "살짝 다듬어준 느낌"

```text
당신은 초등학생이 만든 분기형 이야기의 문장을 "살짝 다듬는" 역할입니다.

수정 강도는 1단계입니다.

목표:
AI가 다시 쓴 것처럼 보이면 안 됩니다.
학생이 쓴 글의 느낌을 유지하면서, 맞춤법·띄어쓰기·문장 연결만 조금 정리합니다.

해야 할 일:
1. 맞춤법을 고칩니다.
2. 띄어쓰기를 고칩니다.
3. 너무 어색한 문장 연결을 자연스럽게 정리합니다.
4. 앞뒤 장면과 흐름이 아주 어색한 경우에만 소폭 수정합니다.
5. 선택지 라벨이 장면 내용과 살짝 어긋나면 자연스럽게 다듬습니다.
6. 학생이 쓴 표현과 분위기는 최대한 유지합니다.

하면 안 되는 일:
1. 문체를 크게 바꾸지 마세요.
2. 문장 수를 크게 늘리지 마세요.
3. 새로운 사건을 추가하지 마세요.
4. 새로운 캐릭터나 설정을 추가하지 마세요.
5. 장면의 의미를 바꾸지 마세요.
6. 선택지의 의미를 바꾸지 마세요.
7. 엔딩의 방향을 바꾸지 마세요.
8. 학생 작품이 AI 글처럼 보이게 만들지 마세요.

수정 기준:
- 원문이 어색해도 학생다운 표현이면 최대한 유지합니다.
- 명백한 오타, 맞춤법, 띄어쓰기만 우선 고칩니다.
- 문장이 너무 길거나 의미가 끊길 때만 가볍게 정리합니다.
- 장면의 분위기와 사건은 그대로 둡니다.

출력 형식:
반드시 아래 [4. AI 출력 JSON 구조] 스키마를 따르세요.
mode="text", level=1.

중요:
- 수정하지 않아도 되는 장면은 sceneEdits에 넣지 않아도 됩니다.
- 단, 수정 대상 장면이 주어졌다면 그 장면은 반드시 검토해야 합니다.
- 본문의 줄바꿈(\n, \n\n)은 원문 그대로 유지하세요. trim 금지.
```

### 1-3. 강도 2 — "장면 발전"

```text
당신은 초등학생이 만든 분기형 이야기의 장면을 더 살아 있게 발전시키는 역할입니다.

수정 강도는 2단계입니다.

목표:
학생의 원래 이야기를 바탕으로 장면을 더 구체적이고 생생하게 만듭니다.
하지만 완전히 다른 작품으로 바꾸면 안 됩니다.

해야 할 일:
1. 강도 1의 맞춤법·띄어쓰기·문장 연결 정리를 포함합니다.
2. 짧은 장면을 조금 더 구체적으로 만듭니다.
3. 배경, 시간, 장소 느낌을 자연스럽게 살립니다.
4. 인물의 행동, 짧은 말, 반응을 추가해 장면을 더 잘 보이게 합니다.
5. 앞뒤 장면과 자연스럽게 이어지도록 흐름을 점검합니다.
6. 선택지가 다음 장면과 자연스럽게 이어지는지 확인합니다.
7. 분기별 설정이 서로 충돌하지 않는지 확인합니다.

하면 안 되는 일:
1. 장면의 핵심 의미를 바꾸지 마세요.
2. 결말 방향을 바꾸지 마세요.
3. 선택지 의미를 바꾸지 마세요.
4. 장면 수를 늘리거나 줄이지 마세요.
5. nextId를 바꾸지 마세요.
6. 원래 없던 큰 사건을 추가하지 마세요.
7. 학생이 의도하지 않은 장르나 분위기로 바꾸지 마세요.
8. 너무 어른스러운 문장으로 바꾸지 마세요.
9. 학생 작품이 AI가 대신 쓴 것처럼 보이면 안 됩니다.

수정 기준:
- "더 잘 쓴 글"보다 "학생 작품이 더 잘 보이는 글"을 목표로 합니다.
- 초등학생 작품의 자연스러운 표현을 완전히 없애지 않습니다.
- 장면의 핵심 행동과 결과는 그대로 유지합니다.
- 추가하는 묘사는 원문에서 자연스럽게 추론 가능한 범위로 제한합니다.

출력 형식:
반드시 [4. AI 출력 JSON 구조] 스키마를 따르세요.
mode="text", level=2.
globalConsistencyCheck 필드를 반드시 채우세요.
AI가 자신 있게 고칠 수 없는 부분은 riskNotes에 적으세요.

중요:
- 본문 줄바꿈(\n, \n\n) 원문 그대로 유지. trim 금지.
- 같은 sceneId가 여러 경로에 등장하면 수정은 한 번만 (모든 경로에 동일 반영됨).
```

---

## 2. 이미지 AI 프롬프트

### 2-1. 강도 1 — 정돈

```text
이 이미지는 초등학생이 직접 그린 그림책 장면입니다.

당신의 역할은 이 그림을 새로 그리는 것이 아니라, 학생 그림의 느낌을 유지하면서 선과 색을 조금 정돈하는 것입니다.

수정 강도는 1단계입니다.

반드시 유지할 것:
1. 원래 캐릭터의 위치
2. 원래 캐릭터의 생김새
3. 원래 배경 배치
4. 원래 장면 구도
5. 원래 색감의 분위기
6. 학생 손그림 느낌
7. 장면의 핵심 의미

해도 되는 것:
1. 선을 조금 더 깔끔하게 정리
2. 색칠이 비어 있거나 삐져나간 부분을 약간 정돈
3. 흐릿한 부분을 조금 선명하게
4. 전체적으로 보기 좋게 정리
5. 종이 스캔 느낌이나 조명 차이를 약간 보정

하면 안 되는 것:
1. 캐릭터 위치를 바꾸지 마세요.
2. 캐릭터를 다른 모습으로 바꾸지 마세요.
3. 배경을 새로 만들지 마세요.
4. 구도를 바꾸지 마세요.
5. 학생 그림을 전문 일러스트처럼 완전히 바꾸지 마세요.
6. 새로운 물건이나 인물을 추가하지 마세요.
7. 원래 장면에 없는 사건을 그리지 마세요.
8. 다른 장면과 스타일이 튀게 만들지 마세요.

스타일:
- 따뜻한 어린이 그림책 느낌
- 손그림 질감 유지
- 과하게 완벽한 디지털 일러스트 금지
- 학생 그림을 깨끗하게 보정한 느낌

출력 목표:
원본을 아는 사람이 봤을 때 "같은 그림인데 더 깔끔해졌다"고 느껴야 합니다.
"AI가 새로 그렸다"고 느끼면 실패입니다.
```

### 2-2. 강도 2 — 발전

```text
이 이미지는 초등학생이 직접 그린 그림책 장면입니다.

당신의 역할은 학생 그림을 완전히 새 그림으로 바꾸는 것이 아니라, 원본 그림의 핵심을 유지하면서 그림책 장면처럼 더 완성도 있게 발전시키는 것입니다.

수정 강도는 2단계입니다.

반드시 유지할 것:
1. 원래 장면의 핵심 의미
2. 주요 캐릭터의 정체성
3. 캐릭터 간 관계
4. 원래 그림의 큰 구도
5. 중요한 사물의 위치
6. 작품 전체의 색감과 분위기
7. 다른 장면과 어울리는 스타일

해도 되는 것:
1. 캐릭터 특징을 조금 더 분명하게 표현
2. 배경을 조금 더 풍부하게 표현
3. 화면 구성을 조금 정리
4. 색을 더 보기 좋게 조정
5. 장면의 분위기를 살리는 작은 디테일 추가
6. 그림책 장면처럼 완성도 높이기

하면 안 되는 것:
1. 완전히 다른 장면으로 바꾸지 마세요.
2. 캐릭터 정체성을 바꾸지 마세요.
3. 핵심 구도를 완전히 바꾸지 마세요.
4. 원래 없는 큰 사건을 추가하지 마세요.
5. 장면의 의미를 바꾸지 마세요.
6. 학생 그림의 개성을 완전히 없애지 마세요.
7. 다른 장면과 스타일이 튀게 만들지 마세요.
8. 과도하게 화려하거나 상업 일러스트처럼 만들지 마세요.

스타일:
- 어린이 그림책 느낌
- 원본 학생 그림을 존중한 발전
- 따뜻하고 부드러운 분위기
- 장면 간 일관된 색감과 선 분위기
- 너무 사실적이지 않게
- 너무 AI 일러스트처럼 매끈하지 않게

출력 목표:
"학생이 그린 장면이 더 풍부하게 발전했다"고 느껴야 합니다.
"완전히 다른 그림으로 바뀌었다"고 느끼면 실패입니다.
```

### 2-3. 작품 단위 일관성 보조 프롬프트

```text
이 작품은 여러 장면이 이어지는 하나의 그림책입니다.
각 장면은 서로 같은 작품처럼 보여야 합니다.

장면별 이미지를 수정할 때 다음 일관성을 유지하세요.

1. 같은 캐릭터는 장면마다 같은 캐릭터처럼 보여야 합니다.
2. 캐릭터의 얼굴, 몸 색, 옷, 주요 특징을 유지하세요.
3. 배경의 색감과 분위기를 유지하세요.
4. 선의 굵기와 질감을 비슷하게 유지하세요.
5. 너무 다른 그림체로 바꾸지 마세요.
6. 한 장면만 지나치게 화려하게 만들지 마세요.
7. 원본 학생 그림의 손그림 느낌을 작품 전체에 유지하세요.

작품 전체 컨텍스트 (런타임에 채워짐):
- 제목: {{project.title}}
- 소개: {{project.subtitle}}
- 주요 캐릭터: {{characters}}      ← 별도 추출 단계 필요 (강도 2 1회 분석)
- 주요 배경: {{settings}}
- 전체 분위기: {{mood}}
- 현재 장면 본문: {{scene.body}}
- 앞 장면 요약: {{prevScene.summary}}
- 다음 장면 요약: {{nextScene.summary}}

현재 장면만 예쁘게 만드는 것보다, 전체 그림책 안에서 자연스럽게 이어지는 것이 더 중요합니다.
```

**가지 추가 검토**: 캐릭터/배경/분위기 추출은 별도 사전 분석 단계로 박아야. 작품 등록 시 1회 또는 변경 시점에 텍스트 AI로 추출 → `projectMeta.aiContext` 같은 노드에 캐시.

---

## 3. AI 입력 JSON 구조

가지 프로젝트의 실제 scene 모델에 맞춰 박은 입력 스키마. `viewer-data.js adaptScenes` 결과와 `storyAnalyzer.js findAllRoutes` 결과를 그대로 활용.

### 3-1. 단일 장면 수정 (singleScene)

```json
{
  "project": {
    "classId": "ABC1D",
    "teamName": "2모둠",
    "title": "숲속 이야기",
    "subtitle": "숲속에서 일어나는 동물들의 이야기",
    "kicker": "4학년 1반 작품",
    "projectType": "picturebook",
    "mode": "story",
    "entrySceneId": "1",
    "replaySceneId": "1"
  },
  "target": {
    "sceneId": "3",
    "scope": "singleScene",
    "level": 1
  },
  "scenes": [
    {
      "id": "1",
      "num": 1,
      "type": "cover",
      "title": "숲속 이야기",
      "subtitle": "숲속에서 일어나는 동물들의 이야기",
      "kicker": "4학년 1반 작품"
    },
    {
      "id": "2",
      "num": 2,
      "type": "normal",
      "title": "",
      "body": "마루와 하루는 길을 가다 멧돼지에게 쫓겼다.\n\n점점 더 빨라지는 발소리...",
      "isStart": true,
      "buttons": [
        { "label": "도망간다",     "nextId": "3" },
        { "label": "나무로 숨는다", "nextId": "4" }
      ]
    },
    {
      "id": "3",
      "num": 3,
      "type": "normal",
      "body": "둘은 숨을 곳도 없이 계속 뛰었다.",
      "buttons": [
        { "label": "강을 건넌다",   "nextId": "5" },
        { "label": "동굴에 들어간다", "nextId": "6" }
      ]
    }
  ],
  "routes": [
    {
      "endingSceneId": "5",
      "kind": "ending",
      "path": [
        { "sceneId": "2" },
        { "fromSceneNum": 2, "choiceIndex": 0, "choiceLabel": "도망간다" },
        { "sceneId": "3" },
        { "fromSceneNum": 3, "choiceIndex": 0, "choiceLabel": "강을 건넌다" },
        { "sceneId": "5", "ending": true }
      ]
    }
  ],
  "constraints": {
    "doNotChangeSceneCount": true,
    "doNotChangeNextId": true,
    "doNotChangeBranchMeaning": true,
    "doNotChangeStructure": true,
    "preserveStudentVoice": true,
    "preserveLineBreaks": true
  },
  "context": {
    "previousSceneId": "2",
    "nextSceneIds": ["5", "6"],
    "sceneRoleInRoute": "middle"
  }
}
```

### 3-2. 작품 전체 수정 (wholeProject)

`target.scope = "wholeProject"` 박고 `target.sceneId` 박지 X. `scenes`는 전체 박음. AI는 routes 박힌 경로별로 일관성 검증 후 수정 제안.

### 3-3. 가지 scene 모델 ↔ AI 입력 매핑

| 가지 필드 | AI 입력 필드 | 출처 |
|---|---|---|
| `ViewerState.scenes[id]` | `scenes[]` | viewer-data.js adaptScenes |
| `scene.id` (= String(num)) | `id` | adaptScenes line ~395 |
| `scene.num` | `num` | maker 호환 |
| `scene.body` | `body` | adaptScenes |
| `scene.title` | `title` | adaptScenes |
| `scene.choices[i]` | `buttons[i]` (maker 형식) | adaptScenes choices ↔ buttons |
| `scene.choices[i].label` | `buttons[i].label` | |
| `scene.choices[i].nextId` | `buttons[i].nextId` | |
| `scene.isEnding` | `isEnding` | |
| `scene.isTrueEnd` | `isTrueEnd` | |
| `scene.type` (cover/normal/ending) | `type` | |
| `scene.subtitle` (cover only) | `subtitle` | |
| `scene.kicker` (cover only, v129) | `kicker` | adaptScenes line ~400 |
| `ViewerState.project.classId` | `project.classId` | viewer-data.js |
| `ViewerState.project.teamName` | `project.teamName` | |
| `ViewerState.project.entrySceneId` | `project.entrySceneId` | |
| `ViewerState.project.replaySceneId` | `project.replaySceneId` | |
| `storyAnalyzer.findAllRoutes()` | `routes[]` | storyAnalyzer.js |

---

## 4. AI 출력 JSON 구조

GPT 박은 최종안 그대로 + 가지 적용/되돌리기 흐름 박은 거 추가.

### 4-1. 텍스트 AI 출력 스키마

```json
{
  "mode": "text",
  "level": 1,
  "targetScope": "singleScene",
  "safeToApply": true,

  "summary": "맞춤법과 문장 흐름을 조금 정리했습니다.",

  "structureCheck": {
    "sceneCountChanged": false,
    "nextIdChanged": false,
    "choiceMeaningChanged": false,
    "newEventAdded": false,
    "coreMeaningChanged": false,
    "lineBreaksPreserved": true
  },

  "sceneEdits": [
    {
      "sceneId": "3",
      "field": "body",
      "original": "둘은 숨을 곳도 없이 계속 뛰었다.",
      "revised":  "둘은 숨을 곳도 없이 계속 뛰었습니다.",
      "changeLevel": "small",
      "reason": "문장을 학생 작품 분위기에 맞춰 자연스럽게 다듬었습니다.",
      "preservedCore": "둘이 도망치는 핵심 상황은 그대로 유지"
    }
  ],

  "choiceEdits": [
    {
      "sceneId": "3",
      "choiceIndex": 0,
      "original": "강을 건넌다",
      "revised":  "강을 헤엄쳐 건넌다",
      "changeLevel": "small",
      "reason": "다음 장면(강 한가운데)과 자연스럽게 이어지도록 표현만 보완"
    }
  ],

  "warnings": [],
  "riskNotes": [],

  "studentCheckQuestions": [
    "이 수정이 우리 작품 느낌을 유지하나요?",
    "AI가 바꾸면 안 되는 부분을 바꾸지는 않았나요?"
  ],

  "doNotAutoApply": true,
  "modelInfo": {
    "model": "claude-haiku-4-5",
    "tokensUsed": 1843,
    "latencyMs": 2104
  }
}
```

### 4-2. 이미지 AI 출력 스키마

이미지 결과 자체는 binary/URL이라 JSON엔 메타만:

```json
{
  "mode": "image",
  "level": 1,
  "targetSceneId": "3",
  "safeToApply": true,

  "originalImageUrl": "https://firebasestorage.googleapis.com/.../scenes/3/original.png",
  "revisedImageUrl":  "https://firebasestorage.googleapis.com/.../scenes/3/ai-v1-1737224400.png",

  "comparison": {
    "characterPositionPreserved": true,
    "compositionPreserved": true,
    "colorMoodPreserved": true,
    "handDrawnFeelingPreserved": true,
    "styleConsistencyWithProject": "high"
  },

  "warnings": [],
  "riskNotes": [],

  "doNotAutoApply": true,
  "modelInfo": {
    "model": "imagen-4-edit",
    "latencyMs": 18402
  }
}
```

### 4-3. 출력 검증 (런타임 차단 조건)

AI 결과가 박은 거여도 다음은 **클라이언트에서 차단**해야 (AI가 박지 X 했다고 박혀있어도 실제 박힌 거 검증):

- `structureCheck.sceneCountChanged === true` → 박지 X
- `structureCheck.nextIdChanged === true` → 박지 X
- `structureCheck.lineBreaksPreserved === false` → 경고
- `safeToApply === false` → 자동 적용 차단, 학생 확인 필수
- `sceneEdits[].sceneId` 박지 X 박힌 거(존재 X) → 박지 X
- `choiceEdits[].choiceIndex` 박은 buttons[] 범위 초과 → 박지 X

---

## 5. HTML 비교 미리보기

GPT 박은 구조 그대로. 가지 프로젝트 폰트/색감 박은 거 정합.

### 5-1. 미리보기 화면 구조

```html
<section class="ai-compare">
  <header>
    <p class="eyebrow">AI 다듬기 결과 · 강도 1</p>
    <h1>우리 작품을 AI가 이렇게 다듬었어요</h1>
    <p>AI 결과를 바로 적용하지 말고, 원본과 비교해 보세요.</p>
  </header>

  <div class="notice">
    AI는 작품을 더 보기 좋게 도울 수 있지만, 작품의 중심은 내가 정해야 합니다.
  </div>

  <article class="scene-card" data-scene-id="3">
    <h2>장면 3</h2>

    <div class="compare-grid">
      <div class="original">
        <h3>원본</h3>
        <p>둘은 숨을 곳도 없이 계속 뛰었다.</p>
      </div>
      <div class="revised">
        <h3>AI 다듬기</h3>
        <p>둘은 숨을 곳도 없이 계속 뛰었습니다.</p>
      </div>
    </div>

    <div class="reason">
      <strong>바뀐 점</strong>
      <p>문장을 학생 작품 분위기에 맞춰 자연스럽게 다듬었습니다.</p>
    </div>

    <div class="preserved">
      <strong>AI가 건드리지 않은 것</strong>
      <p>둘이 도망치는 핵심 상황은 그대로 유지</p>
    </div>

    <div class="student-check">
      <strong>생각해 보기</strong>
      <ul>
        <li>이 문장이 우리 작품 느낌을 유지하나요?</li>
        <li>AI가 바꾸면서 사라진 느낌은 없나요?</li>
      </ul>
    </div>

    <div class="actions" data-scene-id="3" data-field="body">
      <button class="js-ai-accept">이 수정 적용하기</button>
      <button class="js-ai-reject">적용하지 않기</button>
      <button class="js-ai-preview-orig">원본 보기</button>
    </div>
  </article>

  <!-- choice 비교 카드도 동일 구조, data-scene-id + data-choice-index -->
</section>
```

### 5-2. 가지 UI 정합

- 폰트: `'Jua', sans-serif` (v37 정책)
- 보라 톤: `#9b4dca` / `#7030b0` (storyAnalyzer rt-* 같은 톤)
- 본문 표시: `white-space: pre-wrap` (v127 줄바꿈 정책)
- 외부 라이브러리 X — inline CSS

### 5-3. 진입점 (실제 구현 시)

- 인스펙터 (viewer-edit.js `_textEditHtml`) — 본문 옆에 `🤖 AI 다듬기 (강도 1)` / `🤖 AI 발전시키기 (강도 2)` 버튼
- 루트보기 (storyAnalyzer.js) — 루트 단위 일괄 다듬기 (작품 전체 분기 일관성 검증용)
- 모바일 텍스트형 (mobileTextBranch.js) — 장면 편집 화면 하단 토글
- 표지 (renderCover) — 표지 인스펙터에 별도 (단순 다듬기만)

---

## 6. Firebase 읽기 경로

가지 v2 구조 기준. v1 (legacy `teams/${name}`) 호환은 viewer-data.js `basePath` 로직 그대로 따름.

### 6-1. 읽기 (AI 입력 구성용)

```
classes/${classId}/teams/${encodedTeamName}/
  ├─ meta/
  │   ├─ classId, teacher_uid, teacher_email
  │   ├─ isPublic                              # 비공개 작품도 AI 박을 수 있음 (fromMaker 또는 본인 편집)
  │   └─ ...
  ├─ scenes/${num}/
  │   ├─ title
  │   ├─ body
  │   ├─ buttons[]                             # AI 입력의 buttons
  │   ├─ choiceA, choiceB, choiceCount         # legacy 호환
  │   ├─ nextA, nextB                          # AI 절대 변경 X
  │   ├─ type, isEnding, trueEnding
  │   ├─ subtitle, kicker                      # cover only
  │   ├─ imageData OR imageStorageUrl          # 이미지 AI 입력 (v113 마이그 후 Storage URL 박힘)
  │   └─ ...
  ├─ viewer-meta/
  │   ├─ entrySceneId, replaySceneId           # AI 입력의 routes 시작점
  │   ├─ sceneTransition, sceneTransitionSpeed
  │   ├─ textEntrance, textEntranceSpeed
  │   └─ ...
  └─ locks/${num}/                             # AI 적용 시 잠금 확인 (다른 친구 박혀있으면 X)
```

### 6-2. 추가 노드 — **설계 후보** (지금 박지 X)

> ⚠️ **중요**: 아래 노드는 **설계 후보**일 뿐입니다. 실제 Firebase에 박는 건
> Phase A 구현 단계에서 사용자가 박은 정책 결정 후 다시 확정. 지금 박지 X.
> 필드명·구조는 검토 단계에서 변경될 수 있음.

```
classes/${classId}/teams/${encodedTeamName}/
  ├─ ai-suggestions/${suggestionId}/            # AI 결과 저장 (적용 전)
  │   ├─ mode, level
  │   ├─ targetSceneId, targetScope
  │   ├─ requestedBy: {uid, role, requestedAt}
  │   ├─ result: { ...output JSON... }
  │   ├─ status: "pending" | "accepted" | "rejected" | "expired"
  │   ├─ acceptedAt, acceptedBy
  │   └─ ttl: timestamp                          # 24시간 후 자동 만료
  │
  ├─ ai-history/${sceneId}/${historyId}/         # 원본 백업 (수락 직전 스냅샷)
  │   ├─ before: { title, body, buttons }
  │   ├─ after:  { title, body, buttons }
  │   ├─ suggestionId
  │   ├─ acceptedAt
  │   └─ revertedAt                              # 되돌리기 박힌 시점
  │
  └─ ai-context/                                 # 작품 단위 캐시 (이미지 일관성용)
      ├─ characters: ["하루", "마루"]
      ├─ settings:   ["숲", "동굴", "강"]
      ├─ mood:        "따뜻하고 모험적인"
      └─ lastAnalyzedAt
```

### 6-3. Storage 경로 (이미지 AI 결과) — **설계 후보**

```
ai-results/
  ├─ classes/${classId}/
  │   └─ teams/${teamName}/
  │       └─ scenes/${num}/
  │           ├─ ai-v${version}-${timestamp}.png
  │           └─ original-${timestamp}.png      # 백업
```

v113 마이그 정책 그대로 — base64 절대 RTDB 박지 X. AI 결과 이미지도 Storage URL만 박음.

---

## 7. 저장/수락/되돌리기 설계

### 7-1. 흐름 (텍스트)

```
1. 학생/교사가 인스펙터에서 [🤖 AI 다듬기 (강도 1)] 클릭
2. 클라이언트가 입력 JSON 구성 (ViewerState + adaptScenes + findAllRoutes)
3. Cloud Functions로 요청 → Claude API 호출
4. 결과 JSON 받음 → 클라이언트 검증 (4-3 차단 조건)
5. ai-suggestions/${suggestionId} 노드에 저장 (status: "pending", ttl: +24h)
6. HTML 비교 미리보기 열림
7. 학생이 [적용]:
   a. 잠금 확인 (viewerEnsureEditable)
   b. ai-history/${sceneId}/${historyId} 박음 (before/after 스냅샷)
   c. saveSceneText(num, { body, title, buttons, choiceA, choiceB }) 호출
   d. ai-suggestions status: "accepted"
   e. _patchSceneBody/_scheduleViewerFrameReRender 호출 (v130 동기 흐름 그대로)
8. 학생이 [되돌리기] (역사 화면에서):
   a. ai-history에서 before 박은 거 읽음
   b. saveSceneText(num, before) 호출
   c. ai-history revertedAt 박음
```

### 7-2. 핵심 원칙

- **원본 절대 덮어쓰기 X** — ai-history에 before 스냅샷 항상 박음
- **수락 시점에만 saveSceneText 호출** — 그 전엔 ai-suggestions 노드에만 박음
- **잠금 박은 상태에서만 수락 가능** — v129 readonly 정책과 정합
- **suggestionId TTL 24시간** — 미수락 결과 자동 정리 (RTDB 비용 절감, v113 사건 교훈)
- **본문 줄바꿈 그대로** — v127 정책 (trim 박지 X, white-space: pre-wrap)
- **buttons + choiceA/B 동시 저장** — viewer-data.js ALLOWED 그대로 (v130 _rtSaveChoiceLabel 패턴)

### 7-3. 재사용할 가지 함수

이미 박혀있는 함수 그대로 활용 (새 저장 흐름 박지 X):

- `viewer-data.js saveSceneText(num, fields)` — RTDB patch (ALLOWED 화이트리스트)
- `viewer-edit.js _queueSave(num, fields)` — debounce + 잠금 heartbeat
- `viewer-edit.js _patchSceneBody(value)` — viewer-frame 부분 patch (깜빡임 차단)
- `viewer-edit.js _scheduleViewerFrameReRender()` — 통째 재렌더
- `viewer-locks.js viewerEnsureEditable(num)` — 잠금 확보
- `viewer-locks.js viewerIsMyLock(num)` — 자기 잠금 확인
- `storyAnalyzer.js _rtSyncSceneField(num, field, value)` — 메모리 동기 (v130 박은 거)

→ AI 적용 함수 = 위 함수들을 묶은 wrapper (`_aiApplySuggestion(suggestionId)`). 새 저장 경로 박지 X.

### 7-4. Firebase Rules (참고용 — 박을 때 결정)

```json
{
  "rules": {
    "classes": {
      "$classId": {
        "teams": {
          "$teamName": {
            "ai-suggestions": {
              "$suggestionId": {
                ".read":  "auth != null",
                ".write": "auth != null && (data.child('requestedBy/uid').val() === auth.uid || root.child('teachers').child(auth.uid).exists())"
              }
            },
            "ai-history": {
              "$sceneId": {
                ".read":  "auth != null",
                ".write": "auth != null"
              }
            }
          }
        }
      }
    }
  }
}
```

→ rules는 박을 때 다시 검토 필수. 학생 익명 박은 거 박혀있다면 teacher만 ai-history 박을 수 있게 박을지 결정.

---

## 8. 비용/보안 위험

### 8-1. v113 만원 사건 교훈

가지 프로젝트는 2026-05-17 RTDB Storage 마이그(v113)에서 base64 이미지를 RTDB에 박아 만원 정도 비용 발생한 사건 있음. AI 기능 박을 때 같은 실수 반복 박지 X:

- **AI 이미지 결과 = Storage URL만** RTDB 박음. base64 절대 박지 X.
- **AI suggestion 결과 = 텍스트만** RTDB 박음. 큰 결과(>10KB)는 Storage로.
- **ai-history before/after** = 본문만 박음 (텍스트 KB 단위). 이미지 백업은 Storage 경유.
- **TTL** = 24시간. 미수락 결과 자동 정리.

### 8-2. API key 보안

- **Claude API key 클라이언트 박지 X** — 절대 노출 안 됨
- **Cloud Functions 서버사이드만 박음** — Functions 환경변수 또는 Secret Manager
- **Functions endpoint 인증 박음** — Firebase ID token 검증 + 학생/교사 role 검사
- **Functions 호출 quota** — 학생당 분당 1회, 일 5회 등 ratelimit (Functions code 안에서 RTDB counter)

### 8-3. quota 설계

| 단위 | 제한 | 이유 |
|---|---|---|
| **학생 1명** | 일 5회 (텍스트), 일 2회 (이미지) | 과도 사용 차단 |
| **클래스 1개** | 일 100회 (텍스트), 일 30회 (이미지) | 한 교사 책임 비용 한도 |
| **전체 (앱 단위)** | 일 5000회 (텍스트), 일 500회 (이미지) | 글로벌 비용 상한 (긴급 차단 스위치) |
| **단일 요청** | 텍스트 max 8K input + 4K output / 이미지 max 1024x1024 | 단일 요청 비용 보호 |
| **연속 요청 간격** | 학생당 30초 쿨다운 | 클릭 연타 차단 |

### 8-4. 비용 책임

- **교사 결제**: 클래스 단위 비용은 교사 계정 박음 → 교사가 quota 박은 거 인지 + 동의
- **사용량 대시보드**: admin 화면에 클래스별 AI 호출 횟수 표시
- **자동 차단**: quota 도달 시 클라이언트에 안내 메시지 ("오늘 AI 다듬기 사용량을 다 썼어요. 내일 다시 박아주세요.")
- **빌링 알람**: Firebase 결제 알람 + Functions 로그 → 비정상 패턴 감지

### 8-5. 보안 (학생 데이터)

- **공개수업 환경**: 학생 작품이 외부 AI 모델로 전송됨 — 학부모/학교 동의 필요
- **PII 제거**: 학생 이름·실명 박지 X (작품엔 캐릭터 이름만)
- **응답 캐싱 X**: AI 응답은 학생별 격리. 다른 학생 결과 박지 X
- **로그 보관**: AI 요청·응답 로그 30일 보관 후 자동 삭제 (감사용)
- **Claude API 약관**: zero retention 옵션 박혀있다면 활성화

### 8-6. 공개수업 정책 (사용자 박은 거 미확정)

사용자가 이전 세션에서 박은 적 있다고 했지만 메모리 박지 X. **결정 필요**:

- 학생이 직접 AI 박는지 vs 교사 승인 거치는지?
- 강도 1만 학생 자율 허용, 강도 2는 교사 승인 박는지?
- AI 결과 적용은 학생 본인 박는지 교사도 박을 수 있는지?

→ 박을 때 사용자에게 다시 확인 박아야.

---

## 9. 구현 파일 후보

### 9-1. 신규 파일

| 파일 | 역할 | 우선순위 |
|---|---|---|
| `functions/index.js` | Cloud Functions entry — `aiTextSuggest`, `aiImageSuggest`, quota 검증, ratelimit | 1순위 (없으면 API 호출 박지 X) |
| `functions/lib/claudePrompts.js` | 시스템 + 강도별 프롬프트 (이 문서 1·2장 내용) | 1순위 |
| `functions/lib/quota.js` | RTDB counter ratelimit | 1순위 |
| `functions/lib/validators.js` | AI 출력 JSON 검증 (4-3 차단 조건) | 1순위 |
| `viewer-ai.js` | 클라이언트 AI 진입 — 입력 JSON 구성, Functions 호출, suggestion 저장 | 1순위 |
| `viewer-ai-preview.js` | HTML 비교 미리보기 렌더 + accept/reject 핸들러 | 1순위 |
| `viewer-ai-history.js` | ai-history 노드 박은 거 — 되돌리기 UI | 2순위 |
| `viewer-ai-ui.css` | AI 비교 화면 / 버튼 / 배지 스타일 | 1순위 |

### 9-2. 수정 파일

| 파일 | 변경 내용 | 우선순위 |
|---|---|---|
| `viewer.html` | viewer-ai.js / viewer-ai-preview.js / CSS 박음 | 1순위 |
| `maker.html` | 같은 파일들 박음 (maker도 AI 가능 박을지 결정) | 2순위 |
| `viewer-edit.js` `_textEditHtml` | 본문 옆에 [🤖 AI 다듬기] 버튼 박음 | 1순위 |
| `viewer-data.js` `saveSceneText ALLOWED` | 변경 없음 — 기존 ALLOWED 박은 거 그대로 사용 (body/title/buttons/choiceA/B) | — |
| `database.rules.json` | `ai-suggestions/`, `ai-history/`, `ai-context/` 노드 rules 박음 | 1순위 |
| `mobileTextBranch.js` | 모바일 텍스트형 편집 화면 AI 진입 박음 | 3순위 |
| `storyAnalyzer.js` | 루트 단위 AI 일괄 검증 진입 박음 (선택) | 4순위 |
| `firebase.json` | Functions 배포 설정 박음 | 1순위 |

### 9-3. 활용 가능한 기존 함수 (재사용)

| 함수 | 위치 | 용도 |
|---|---|---|
| `saveSceneText` | viewer-data.js | AI 결과 적용 (수락 시) |
| `_queueSave` / `_flushPendingSave` | viewer-edit.js | debounce 저장 (단일 장면) |
| `_patchSceneBody` / `_scheduleViewerFrameReRender` | viewer-edit.js | viewer 갱신 |
| `viewerEnsureEditable` / `viewerIsMyLock` | viewer-locks.js | 잠금 확인 |
| `_rtSyncSceneField` | storyAnalyzer.js (v130) | 메모리 동기 |
| `findAllRoutes` | storyAnalyzer.js | AI 입력 routes 박음 |
| `adaptScenes` | viewer-data.js | AI 입력 scenes 박음 |

→ AI 기능 박을 때 **새 저장 경로 박지 X**. v130 박은 인라인 수정 패턴 그대로 따라 박음.

---

## 10. 구현 우선순위

### 10-1. 단계 권장 순서

**Phase A — 인프라 박기 (코드 박을 거)**
1. Firebase Functions 설정 + 배포 환경
2. Claude API key 박음 (Secret Manager)
3. `aiTextSuggest` Functions endpoint (강도 1만) — 입력 검증 + Claude 호출 + quota check
4. `viewer-ai.js` 기본 — 입력 JSON 구성 + Functions 호출
5. `ai-suggestions` 노드 + rules 박음

**Phase B — UI 박기**
6. `viewer-ai-preview.js` 비교 화면
7. `viewer-edit.js _textEditHtml`에 버튼 박음 (강도 1)
8. accept/reject 흐름 + `saveSceneText` 호출
9. 작은 클래스 1개에서 베타 테스트

**Phase C — 안전망 박기**
10. ai-history 백업 + 되돌리기
11. quota 도달 안내 UI
12. admin 사용량 대시보드
13. 비정상 패턴 모니터링

**Phase D — 강도 2 + 이미지**
14. 텍스트 강도 2 (전체 분기 일관성 검증 포함)
15. ai-context 작품 분석 (이미지 일관성용)
16. 이미지 강도 1 (정돈) — 모델 선택 (Imagen Edit / DALL-E inpaint / SDXL)
17. 이미지 강도 2 (발전)
18. Storage 박은 결과 URL 흐름

**Phase E — 통합**
19. 모바일 텍스트형 AI 진입
20. 루트보기 일괄 다듬기 (작품 전체)
21. 다국어 / 학년별 프롬프트 미세 조정

### 10-2. 1단계 박을 거 (MVP)

**박지 X 박을 거**:
- 이미지 AI (별도 Phase D)
- 강도 2 (Phase D)
- 작품 전체 일괄 (singleScene만)
- 자동 적용 (반드시 확인 화면 거침)
- 학생 자율 박을지 (교사 승인 박는지 사용자 결정 박혀야)

**박을 거**:
- 텍스트 강도 1 (단일 장면)
- 인스펙터 본문 옆 [🤖 AI 다듬기] 버튼
- 비교 화면 → 적용 / 보류
- ai-suggestions + ai-history 노드
- 학생 일 5회 quota
- 클래스 일 100회 quota

### 10-3. 사용자 박을 결정 (구현 전)

다음은 코드 박기 전 사용자 확인 박아야:

1. **공개수업 정책** — 학생 자율 vs 교사 승인 (사용자 박은 거 메모리 박지 X — 확인 필요)
2. **모델 선택** — Claude Haiku (저렴) vs Sonnet (품질)
3. **빌링 책임자** — 학교 / 교사 개인 / 가지 운영자
4. **이미지 모델** — Imagen / DALL-E / SDXL 중 어느 것 (Claude는 이미지 생성 박지 X)
5. **베타 클래스** — 처음 박을 때 1개 클래스만 박을지 (위험 격리)
6. **학부모 동의** — 외부 AI 모델 박는 거 학교/학부모 동의 박을지

---

---

## 11. Phase 0 결정문

> **이 섹션의 목적**: Phase A(실제 구현)에 들어가기 전, 사용자가 박아둬야 할
> 정책 결정문. v130 직후 GPT 박은 평가 그대로 옮긴 초안 + 사용자가 직접 박을
> 자리 박음. **이 결정문이 박힌 후에만 Phase A 진행**.

### 11-1. GPT 박은 추천 초안 (사용자 확정 박지 X)

> AI 기능 1차 구현 정책 (추천 초안)
>
> 1. 공개수업에서는 **교사 시연형**으로만 사용한다.
> 2. 1차 구현은 **텍스트 AI 강도 1**만 한다.
> 3. AI 결과는 **HTML 비교 미리보기**로만 보여준다.
> 4. 원본에는 **자동 적용하지 않는다**.
> 5. 적용은 **교사 또는 제작자가 수락할 때만** 한다.
> 6. **이미지 AI는 아직 구현하지 않는다**.
> 7. API 호출은 **Cloud Functions를 통해서만** 한다.
> 8. **quota를 박기 전에는 학생에게 공개하지 않는다**.

이 초안은 GPT 박은 평가 박은 거 그대로. 사용자가 확정 박을 자리 (11-3).

### 11-2. 사용자 박을 결정 항목

GPT 박은 평가에서 박은 4개 핵심 + [10-3] 박은 6개 결정 항목 통합:

| # | 항목 | 선택지 | 사용자 확정 |
|---|---|---|---|
| 1 | **공개수업 모드** | 교사 시연형 / 학생 체험형 | ☐ 박을 자리 |
| 2 | **1차 범위** | 텍스트 강도 1만 / 강도 1+2 / 이미지 포함 | ☐ |
| 3 | **자동 적용** | 자동 적용 X (확인 화면 거침) / 강도 1만 자동 / 자동 박음 | ☐ |
| 4 | **적용 권한** | 교사만 / 제작자만 / 학생 본인 | ☐ |
| 5 | **API 구조** | Cloud Functions 경유 / 클라이언트 직접 (보안 위험) | ☐ |
| 6 | **모델 선택** (텍스트) | Haiku 4.5 (저렴) / Sonnet 4.6 (품질) / 둘 다 (강도별) | ☐ |
| 7 | **모델 선택** (이미지, 후순위) | Imagen Edit / DALL-E / SDXL / 박지 X | ☐ |
| 8 | **quota — 학생** | 일 5회 (제안) / 다른 값 | ☐ |
| 9 | **quota — 클래스** | 일 100회 (제안) / 다른 값 | ☐ |
| 10 | **빌링 책임자** | 학교 / 교사 개인 / 가지 운영자 | ☐ |
| 11 | **베타 클래스** | 1개 클래스만 / 여러 클래스 / 운영 시작부터 전체 | ☐ |
| 12 | **학부모 동의** | 명시 동의 박은 후만 / 학교 일괄 동의 / 박지 X | ☐ |
| 13 | **AI 결과 보관** | TTL 24h (제안) / 30일 / 영구 | ☐ |
| 14 | **공개수업 시연 시점** | 1차 구현 직후 / quota·로그 박은 후 | ☐ |

### 11-3. 사용자 확정 결정 (박을 자리)

> 이 자리에 사용자가 박은 결정 박은 후 Phase A 진행.
>
> ```
> 결정 박은 날: YYYY-MM-DD
> 박은 사람: dobuk
>
> 1. 공개수업 모드: __________
> 2. 1차 범위: __________
> 3. ...
> ```

### 11-4. Phase A 진행 조건

다음 항목 박힌 후에만 Phase A 시작:

- [ ] 11-2 14개 항목 모두 박힘 (사용자 결정)
- [ ] 학부모/학교 동의 박힘 (외부 AI 모델 박는 거)
- [ ] Firebase 결제 알람 박힘 (v113 만원 사건 재발 방지)
- [ ] 베타 클래스 1개 박힘 (위험 격리)
- [ ] 비상 차단 스위치 박는 위치 박힘 (Cloud Functions 강제 종료 경로)

### 11-5. 박지 X 박을 거 (Phase 0 단계)

Phase 0 = 결정문 박는 단계. 실제 박지 X:

- 실제 Firebase에 `ai-suggestions/`/`ai-history/`/`ai-context/` 노드 박지 X
- Firebase rules 변경 박지 X
- Cloud Functions 배포 박지 X
- Claude API key 박지 X
- viewer-edit.js에 AI 버튼 박지 X
- maker.html에 AI 버튼 박지 X
- mobileTextBranch.js에 AI 진입 박지 X

설계 문서 박은 거 + Phase 0 결정문 박은 거 이 두 가지만. 그 외는 모두 Phase A부터.

---

## 부록 A — 모델 선택 권장

### 텍스트
- **강도 1**: Claude Haiku 4.5 — 빠르고 저렴 (~$0.0008/요청 추정). 맞춤법·문장 정리 충분.
- **강도 2**: Claude Sonnet 4.6 — 분기 일관성 검증 박을 때 추론 능력 필요 (~$0.005/요청 추정).

### 이미지
- **강도 1 (정돈)**: Imagen Edit / SDXL img2img (low strength) — 원본 보존
- **강도 2 (발전)**: Imagen Edit (controlled) / SDXL img2img (medium strength) — 구도 유지

→ 이미지는 Claude API 박지 X (Claude는 이미지 생성 박지 X). 별도 모델 박혀야.

## 부록 B — 가지 박은 코드 위치 빠른 참조

- 작품 데이터 로드: `viewer-data.js loadTeamData()`
- 장면 정규화: `viewer-data.js adaptScenes()`
- 장면 저장: `viewer-data.js saveSceneText(num, fields)`
- 잠금: `viewer-locks.js viewerEnsureEditable(num)`
- 본문 patch: `viewer-edit.js _patchSceneBody(value)`
- 통째 재렌더: `viewer-edit.js _scheduleViewerFrameReRender()`
- 루트 분석: `storyAnalyzer.js findAllRoutes(startNum)`
- 인라인 수정 패턴: `storyAnalyzer.js _rtSaveBody/_rtSaveChoiceLabel` (v130 박은 거 — AI 적용도 같은 패턴)
- 인스펙터 본문 입력: `viewer-edit.js _textEditHtml` line ~1830
- 모바일 텍스트형 편집: `mobileTextBranch.js _mtbOpenEditScene`

---

## 부록 C — 다음 세션 가이드

이 문서는 **설계 문서**이며 코드 변경 박지 X. AI 기능 실제 구현 박을 때:

1. 이 문서 + `project_branch_ai_design.md` 메모리 둘 다 박음
2. **[11. Phase 0 결정문] 박혔는지 확인** — 박지 X 박혔으면 Phase A 박지 X
3. Phase A부터 순서대로 박음
4. 각 Phase 후 사용자 검증 받음
5. v113 만원 사건 교훈 항상 박음 — 비용 모니터링 우선
6. 새 저장 함수 박지 X — 기존 saveSceneText + _queueSave 재사용
7. 본문 줄바꿈(v127), 잠금(v129), 인라인 동기(v130) 정책 모두 정합 박음
8. **6-2 박은 신설 노드 = 설계 후보** — 실제 박을 때 다시 확정 박음

---

**문서 버전**: 2026-05-18 v130 직후 박음
**보정 1회**: 2026-05-18 v130 직후 GPT 평가 받아 박음
- 신설 노드 = 설계 후보 명시
- Phase 0 결정문 섹션 박음

**다음 갱신**: Phase 0 결정문 박힌 후 (사용자 14개 항목 확정) 또는 Phase A 박을 때
