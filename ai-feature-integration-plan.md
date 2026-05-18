# 가지(branch) AI 기능 통합 설계 문서 — **v2 (제품 기능 기준)**

> **이 문서의 목적**: 가지(branch) 제품 안에 들어갈 AI 다듬기 기능의 정체성·정책·프롬프트·입출력 구조·저장 흐름·비용·구현 우선순위를 정의한 사전 설계 문서.
>
> **현재 단계**: 설계 문서화만. 실제 AI API 연결·Cloud Functions·DB 필드·UI 버튼·rules 변경은 진행하지 않는다.
>
> **v2 갱신 이유 (2026-05-18)**:
> - v1은 수업자료/공개수업 맥락이 섞여서 1단계와 2단계의 정체성이 흔들렸음
> - v1 기준으로 만든 결과물에서 1단계와 2단계 차이가 너무 작게 나타남
> - 본 v2는 **제품 기능 기준만** 사용 — 수업 맥락 완전 제거
> - 변화 폭 % 수치 대신 **허용 행동/금지 행동 체크리스트** 도입
> - 이미지는 모델/파라미터 선택이 설계의 일부임을 명시
> - quota를 베타 → 안정화 두 단계로 분리
>
> **출처**:
> - 사용자 v106 세션 (2026-05-16) AI 기능 설계 원본 — `project_branch_ai_design.md` 메모리
> - GPT 재설계안 (2026-05-18) — 수업 맥락 배제, 제품 기능 기준
> - Claude 검토 답변 (2026-05-18) — 변화 폭 측정 문제, 모델 선택, 출력 JSON 구조 보완
> - 가지 v130 시점 실제 코드 구조

---

## 목차

0. [기능의 정체성과 큰 원칙](#0-기능의-정체성과-큰-원칙)
1. [텍스트 AI 1단계/2단계 — 체크리스트 정의](#1-텍스트-ai-1단계2단계--체크리스트-정의)
2. [이미지 AI 1단계/2단계 — 모델·파라미터 기반](#2-이미지-ai-1단계2단계--모델파라미터-기반)
3. [AI 입력 JSON 구조](#3-ai-입력-json-구조)
4. [AI 출력 JSON 구조 (safeAddition / creativeAddition)](#4-ai-출력-json-구조)
5. [사용자에게 보여주는 비교 화면 구조](#5-사용자에게-보여주는-비교-화면-구조)
6. [Firebase 읽기 경로](#6-firebase-읽기-경로)
7. [원본 보존 / 적용 / 되돌리기 설계](#7-원본-보존--적용--되돌리기-설계)
8. [비용·quota — 단계별 정책](#8-비용quota--단계별-정책)
9. [구현 시 필요한 파일 후보](#9-구현-파일-후보)
10. [구현 우선순위](#10-구현-우선순위)
11. [Phase 0 결정문](#11-phase-0-결정문)

---

## 0. 기능의 정체성과 큰 원칙

### 0-1. AI 다듬기 기능의 정체성

가지의 AI 다듬기는 **학생 작품을 대신 만들지 않는다**. 또한 **단순 맞춤법 검사기**도 아니다.

정체성은 다음 한 줄로 요약된다.

> **사용자가 만든 분기형 이야기와 그림책 장면을 바탕으로, 원본 구조를 지키면서 표현의 완성도를 높이는 보조 기능.**

두 단계의 한 줄 정의:

- **1단계 = 안심하고 받을 수 있는 정돈**
- **2단계 = 매력적이지만 판단이 필요한 발전**

### 0-2. 핵심 원칙 (변경 불가)

**브랜치 구조는 절대 바꾸지 않는다**

AI가 손댈 수 없는 항목:
- 장면 수
- sceneId
- nextId
- 선택지 연결
- 엔딩 위치 / 진엔딩 여부
- 분기 흐름
- 장면 순서
- 원본 이미지 파일 자체
- 원본 데이터 (저장 전 상태)

AI가 손댈 수 있는 항목:
- 장면 제목
- 장면 본문
- 선택지 라벨
- 그림 표현 결과물 제안
- 이미지 다듬기 결과물 제안

즉, AI는 **내용 표현을 제안**할 수 있지만 **구조는 건드리지 않는다**.

**원본은 반드시 보존한다**

- AI 결과는 원본을 자동으로 대체하지 않는다
- 1단계 결과 / 2단계 결과 / 원본은 별도로 저장된다
- 사용자가 명시적으로 적용하기 전까지 원본은 그대로 유지된다
- 적용 후에도 되돌리기가 가능하다

**AI는 장면 하나만 보지 않는다 (특히 2단계)**

텍스트 AI는 다음 정보를 함께 본다:
- 전체 장면 목록
- 각 장면의 본문과 선택지
- 선택지별 nextId
- 시작 장면 / 엔딩 장면 / 진엔딩
- 이 장면으로 들어오는 선택지
- 이 장면에서 나가는 선택지
- 루트보기/경로 분석 결과
- 반복 등장하는 캐릭터·설정

2단계는 이 맥락 분석 없이 진행하지 않는다.

### 0-3. 가지 프로젝트 정합 정책

- **본문 줄바꿈 유지** (v127 정책) — `\n\n` 절대 trim 하지 않음. AI 결과도 줄바꿈 그대로 보존
- **buttons + choiceA/B 호환** — AI가 라벨을 수정하면 두 필드 모두 동기화 (viewer-data.js ALLOWED 기준)
- **잠금 상태 준수** (v129 정책) — "내가 수정하기" 전에는 AI 적용도 불가능
- **Storage 경유** (v113 만원 사건 이후) — 이미지 결과는 Storage URL만 RTDB에 저장. base64 금지
- **모바일 텍스트형 통합** — `mobileTextBranch.js` 모바일 UI에도 AI 진입점이 들어가야 함

---

## 1. 텍스트 AI 1단계/2단계 — 체크리스트 정의

### 1-1. 공통 시스템 프롬프트

모든 텍스트 AI 호출에 공통으로 들어가는 베이스.

```text
당신은 초등학생이 만든 분기형 이야기를 도와주는 AI 보조자입니다.

이 작품은 일반적인 일직선 글이 아니라, 여러 장면과 선택지가 연결된 
"분기형 이야기"입니다. 따라서 한 장면만 보고 고치면 안 됩니다.
반드시 전체 장면 구조, 선택지 흐름, 엔딩, 앞뒤 맥락을 함께 고려해야 합니다.

당신의 역할은 학생 작품을 대신 만드는 것이 아니라, 학생이 만든 작품을 
더 잘 보이도록 도와주는 것입니다.

가장 중요한 원칙:

1. 작품의 주인은 학생입니다.
2. AI는 보조자입니다.
3. 원작의 핵심 의미를 바꾸면 안 됩니다.
4. 장면 수를 바꾸면 안 됩니다.
5. 선택지의 의미를 바꾸면 안 됩니다.
6. nextId, 분기 흐름을 바꾸면 안 됩니다.
7. 원래 없던 사건, 설정, 캐릭터를 마음대로 추가하면 안 됩니다.
8. 학생의 문체와 의도를 최대한 유지해야 합니다.

수정 가능 영역: 장면 본문(body), 장면 제목(title), 선택지 라벨(label).
수정 금지 영역: 장면 수, sceneId, nextId, 선택지 연결, 엔딩 위치.

본문의 줄바꿈(\n, \n\n)은 학생이 의도적으로 넣은 호흡일 수 있습니다.
절대 trim하지 마세요.

한 장면이 여러 경로에 반복 등장할 수 있습니다. 같은 sceneId의 수정은 
모든 경로에 동일하게 적용됩니다.

출력은 반드시 구조화된 JSON으로 작성합니다 (별도 스키마 참조).
```

### 1-2. 1단계 — 안심하고 받을 수 있는 정돈

**한 줄 정의**: 기존 문장을 읽기 좋게 정리하되, 새 정보는 거의 넣지 않는다.

**허용 행동 체크리스트** (이것만 한다)

- [ ] 맞춤법 수정
- [ ] 띄어쓰기 수정
- [ ] 조사 자연스럽게 수정
- [ ] 너무 끊긴 문장을 자연스럽게 연결
- [ ] 어색한 표현 정리
- [ ] 생략된 주어/대상의 최소 보충 (이해 안 되는 경우만)
- [ ] 선택지 라벨 표현 정돈
- [ ] 문장을 읽기 좋게 재배열 (의미 변경 없이)

**금지 행동 체크리스트** (이것은 하지 않는다)

- [ ] 새 문장 여러 개 추가
- [ ] 새 대사 추가
- [ ] 배경 묘사 추가
- [ ] 감정 표현 크게 추가
- [ ] 사건 확대
- [ ] 새로운 설정 추가
- [ ] 캐릭터 성격 추가
- [ ] 장면 분위기 변경
- [ ] 결말 의미 변경
- [ ] 선택지 의미 변경

**검증 조건** (후처리)

- 원문 글자 수 대비 결과 글자 수 비율이 0.8 ~ 1.3 사이여야 한다 (벗어나면 재시도)
- 새 문장(원문에 없는 의미 단위)을 추가했으면 재시도
- 출력 JSON의 `structureCheck` 필드가 모두 `true`여야 한다

**프롬프트 지시문 (1단계)**

```text
이번 작업은 "1단계 정돈"입니다.

해야 할 것:
- 맞춤법, 띄어쓰기, 조사를 자연스럽게 정리
- 너무 끊긴 문장을 부드럽게 연결
- 어색한 표현 정돈
- 이해 안 되는 부분에서 주어/대상 최소 보충

하지 말 것:
- 새 문장 추가 금지
- 새 대사 추가 금지
- 배경 묘사 추가 금지
- 감정 표현 추가 금지
- 사건이나 설정 추가 금지

규칙: 결과의 글자 수는 원문의 0.8 ~ 1.3배 안에 있어야 합니다.
규칙: 학생이 쓴 문장의 느낌이 남아야 합니다.
규칙: 새 정보를 넣지 마세요. 기존 문장만 다듬으세요.
```

**좋은 1단계 예시**

```
원문:
마루, 하루가 길을 가다 멧돼지에 쫓긴다. 도망가고 있는데 숲속에서 소리가 난다.

1단계:
마루와 하루는 길을 가다가 갑자기 멧돼지에게 쫓기게 되었다. 
도망치는 중에 숲속 어딘가에서 이상한 소리가 들려왔다.
```

원문 사건/캐릭터/분기 구조 그대로. 표현만 정돈.

### 1-3. 2단계 — 매력적이지만 판단이 필요한 발전

**한 줄 정의**: 원래 사건과 분기 구조는 유지하되, 장면의 배경·행동·대사·감정·인과를 보충하여 더 완성도 있는 장면으로 발전시킨다.

**허용 행동 체크리스트** (이것을 할 수 있다)

- [ ] 1단계 정돈 모두 포함
- [ ] 배경 묘사 추가
- [ ] 인물 행동 묘사 추가
- [ ] 짧은 대사 추가
- [ ] 감정 반응 추가
- [ ] 장면 분위기 강화
- [ ] 들어오는 선택지의 결과를 도입에 반영
- [ ] 나가는 선택지로 이어질 기대감 만들기
- [ ] 생략된 인과 보충
- [ ] 분기별 일관성 점검
- [ ] 두 선택지가 같은 장면으로 향하는 경우 의미 차이를 본문에서 살리기

**금지 행동 체크리스트** (이것은 하지 않는다)

- [ ] 장면 수 변경
- [ ] nextId 변경
- [ ] 선택지 의미 변경
- [ ] 결말 방향 변경
- [ ] 캐릭터 정체성 변경
- [ ] 원작에 없는 큰 사건 추가
- [ ] 고유명사 삭제 또는 일반화 ("뇨뇨" → "엘프" 같은 변환 금지)
- [ ] 학생 작품의 핵심 설정 변경
- [ ] 장르 변경
- [ ] 너무 어른스럽고 매끈한 문체로 변환

**검증 조건** (후처리)

- 결과 글자 수가 원문의 1.5배 이상이어야 한다 (그 미만이면 1단계와 차이가 부족하니 재시도)
- 결과 글자 수가 원문의 4배를 넘으면 재시도 (과도)
- 캐릭터 이름이 모두 보존되었는지 확인
- 출력 JSON의 `structureCheck`, `preservedCheck` 필드가 모두 `true`

**2단계가 반드시 거치는 분석 절차**

장면만 다시 쓰면 안 된다. 다음 절차를 거친 뒤에야 본문을 작성한다.

1. 전체 장면 구조 파악 (분기 그래프)
2. 이 장면으로 들어오는 선택지 확인
3. 이 장면에서 나가는 선택지 확인
4. 약한 연결 식별 (인과가 자연스럽지 않은 분기)
5. 생략된 설명 식별
6. 위 분석을 반영하여 본문 발전

이 절차는 입력 JSON에 분석 결과를 함께 넣음으로써 강제한다 (3장 참조).

**프롬프트 지시문 (2단계)**

```text
이번 작업은 "2단계 발전"입니다.

먼저 분석:
1. 입력 JSON의 routes를 보고 이 장면의 위치를 파악
2. 들어오는 선택지(들)의 의미를 본문에 자연스럽게 반영
3. 나가는 선택지(들)의 의미가 본문 끝에서 자연스럽게 이어지도록
4. 입력 JSON의 weakConnections에 이 장면이 있으면 그 보충을 우선

해야 할 것:
- 1단계 정돈 모두 포함
- 배경, 시간, 장소 느낌 보충
- 인물의 행동, 짧은 말, 반응 추가
- 장면 분위기 강화 (긴장감/따뜻함/슬픔 등 원작 톤 살리기)
- 앞뒤 장면과의 연결이 자연스럽도록 보충

하지 말 것:
- 장면 수, nextId, 선택지 의미 변경 금지
- 캐릭터 정체성 변경 금지
- 원작에 없는 큰 사건 추가 금지
- 학생이 쓴 고유명사(뇨뇨, 시민, 막대자 등) 변경 금지
- 너무 어른스럽고 매끈한 문체로 변환 금지

규칙: 결과 글자 수는 원문의 1.5 ~ 4배 안에 있어야 합니다.
규칙: 새로 넣은 묘사/대사 중 원문에서 추론 불가능한 것은 
      creativeAddition으로 표시해주세요.
규칙: 원문에서 자연스럽게 추론 가능한 것은 safeAddition으로 표시해주세요.
```

**좋은 2단계 예시**

```
원문:
마루, 하루가 길을 가다 멧돼지에 쫓긴다. 도망가고 있는데 숲속에서 소리가 난다.

2단계:
마루와 하루는 조용한 숲길을 나란히 걷고 있었다. 그때 뒤쪽 풀숲에서 
"부스럭" 하는 소리가 들렸다. 두 친구가 고개를 돌리는 순간, 커다란 
멧돼지가 씩씩거리며 달려왔다.

"도망쳐!"

마루가 외치자, 둘은 정신없이 숲길을 따라 뛰기 시작했다. 한참을 달리다 
보니, 이번에는 깊은 숲속 어딘가에서 처음 듣는 이상한 소리가 들려왔다.
```

원문 사건/캐릭터/분기 그대로. 배경·대사·움직임이 추가됨.

### 1-4. 1단계 vs 2단계 — 한눈 비교

| 항목 | 1단계 정돈 | 2단계 발전 |
|---|---|---|
| 목적 | 읽기 좋게 정리 | 장면을 살아 있게 발전 |
| 원문 유지 | 매우 강함 | 핵심만 유지 |
| 분량 변화 | 0.8 ~ 1.3배 | 1.5 ~ 4배 |
| 새 문장 추가 | 금지 | 가능 |
| 대사 추가 | 금지 | 가능 |
| 배경 묘사 | 금지 | 가능 |
| 감정 표현 | 최소 (기존만 다듬기) | 추가 가능 |
| 장면 간 연결 보충 | 매우 약하게 | 적극적 |
| AI 해석 개입 | 거의 없음 | 중간 |
| 구조 분석 필요 | 선택 | **필수** |
| 적용 안정성 | 높음 (자동 적용도 가능한 수준) | 사용자 검토 필요 |

---

## 2. 이미지 AI 1단계/2단계 — 모델·파라미터 기반

이미지는 텍스트와 달리 **프롬프트만으로는 1단계와 2단계 차이를 안정적으로 통제할 수 없다.** 따라서 모델 선택과 파라미터(특히 denoising strength)가 설계의 핵심이다.

### 2-1. 이미지 1단계 — 손그림 정돈

**한 줄 정의**: 학생 그림의 구도와 캐릭터는 그대로 두고, 선·색·스캔 상태만 조금 정리한다.

**기술 사양**

- 권장 모델: SDXL img2img (Replicate) 또는 Imagen Edit
- denoising strength: **0.20 ~ 0.30** (낮게)
- ControlNet (선택): canny edge — 원본 윤곽 강제 유지
- 입력: 원본 학생 이미지 + 짧은 프롬프트 (상세 묘사 X)

**허용 행동 체크리스트**

- [ ] 흐릿한 선을 조금 또렷하게
- [ ] 색칠이 비어 있거나 삐져나간 부분을 살짝 정돈
- [ ] 색감 균형 조정
- [ ] 종이 스캔 얼룩이나 조명 차이를 약간 보정
- [ ] 손그림 질감 유지

**금지 행동 체크리스트**

- [ ] 캐릭터 위치 변경
- [ ] 캐릭터 얼굴/외형 변경
- [ ] 구도 변경
- [ ] 배경 새로 만들기
- [ ] 새 인물/사물 추가
- [ ] 장면 의미 변경
- [ ] 디지털 일러스트 톤으로 매끈하게 변환
- [ ] 손그림 낙서 느낌 제거

**검증 조건**

- 사람이 봤을 때 "내 그림이 조금 더 깨끗해졌다" 정도면 성공
- "AI가 새로 그렸다"고 느껴지면 실패

**프롬프트 예시**

```text
Edit this children's storybook scene drawn by an elementary student.
Keep all character positions, faces, composition, and background EXACTLY 
as drawn. Only smooth rough pencil marks, fill small color gaps, and 
slightly clean up paper scan artifacts. Maintain the hand-drawn warmth 
and crayon texture. Do not redraw, do not change anything structural.

Result should feel like the same drawing, just slightly neater.
```

### 2-2. 이미지 2단계 — 그림책 장면화

**한 줄 정의**: 학생 그림의 핵심 구도와 캐릭터를 유지하면서, 빛·표정·배경·움직임·분위기를 더해 그림책 장면처럼 발전시킨다.

**기술 사양**

- 권장 모델: SDXL img2img + ControlNet (Replicate) 또는 Imagen 3 + style reference
- denoising strength: **0.45 ~ 0.55** (중간)
- ControlNet: canny edge 또는 lineart — 구도/캐릭터 위치 유지
- Style reference (작품 단위): 첫 번째 2단계 결과 또는 작품 대표 장면을 reference로 사용 → 21장 사이 일관성 강제
- 입력: 원본 이미지 + 상세 프롬프트 + style reference (선택)

**허용 행동 체크리스트**

- [ ] 캐릭터 표정을 더 또렷하게
- [ ] 몸짓을 분명하게
- [ ] 배경에 깊이감 추가
- [ ] 빛과 그림자 추가
- [ ] 움직임 표현 (모션 라인, 흙먼지 등)
- [ ] 중요한 소품 강조
- [ ] 장면 의미가 잘 보이게 화면 구성 정리
- [ ] 그림책 페이지 같은 화면 보강

**금지 행동 체크리스트**

- [ ] 캐릭터를 다른 인물처럼 변경
- [ ] 얼굴/머리/옷 정체성 변경
- [ ] 구도 완전 변경
- [ ] 원작에 없는 큰 배경 추가
- [ ] 상업 일러스트처럼 매끈하게 변환
- [ ] 장면 의미 변경
- [ ] 다른 장면과 스타일이 튀게 만들기

**검증 조건**

다음 세 질문에 모두 "예"여야 한다:
- 원본을 알아볼 수 있는가?
- 같은 작품의 장면인가?
- 학생 그림에서 출발했다는 느낌이 남아 있는가?

**작품 단위 일관성 — 21장 시퀀스에서 가장 중요**

2단계는 한 장만 발전시키는 게 아니라 21장 전체가 같은 그림체로 보여야 한다.

전략:
1. **Style anchor 장면 1장 먼저 작업** — 그 결과를 style reference로 박음 (예: 가장 도입 장면 또는 가장 자주 등장하는 장면)
2. **나머지 장면들은 style reference 강제 적용** — Imagen 3의 style reference 기능 또는 SDXL의 IP-Adapter
3. **캐릭터 일관성** — 캐릭터별 LoRA 학습은 운영 규모상 과함. 대신 style reference + 상세 프롬프트로 처리
4. **품질 편차 발생 시** — 같은 장면 1~2회 재생성 허용

### 2-3. 이미지 1단계 vs 2단계 — 한눈 비교

| 항목 | 1단계 정돈 | 2단계 발전 |
|---|---|---|
| 목적 | 그림을 깨끗하게 | 장면을 그림책 페이지처럼 |
| 구도 | 그대로 | 큰 틀 유지 |
| 캐릭터 | 그대로 | 정체성 유지하면서 또렷하게 |
| 배경 | 거의 그대로 | 깊이감/분위기 추가 |
| 색감 | 살짝 정리 | 더 풍부하게 |
| 움직임 표현 | 거의 없음 | 추가 가능 |
| denoising strength | 0.20 ~ 0.30 | 0.45 ~ 0.55 |
| ControlNet | 권장 | 거의 필수 |
| Style reference | 불필요 | 작품 일관성 위해 권장 |
| AI 해석 개입 | 낮음 | 중간 |
| 적용 안정성 | 높음 | 사용자 검토 필요 |

### 2-4. 모델별 비교 (운영 시 선택)

| 모델 | 1단계 적합성 | 2단계 적합성 | 손그림 톤 | 캐릭터 일관성 | 비용/이미지 |
|---|---|---|---|---|---|
| DALL-E 3 (OpenAI) | 약함 (원본 보존 약함) | 약함 (1.5단계 수준이 한계) | 약함 | 약함 | $0.04 |
| Imagen 3 (Google) | 좋음 | 좋음 (style reference 강함) | 중간 | 중간 | 약 $0.04 |
| **SDXL img2img + ControlNet (Replicate)** | **매우 좋음** | **매우 좋음** | **강함** | 중간 (IP-Adapter 필요) | $0.01 ~ 0.03 |
| Flux img2img (Replicate) | 좋음 | 좋음 (최신, 품질 ↑) | 강함 | 중간 | $0.03 ~ 0.05 |

**추천 조합**: 1단계 = SDXL img2img low strength + ControlNet canny / 2단계 = SDXL img2img medium strength + ControlNet canny + IP-Adapter style reference.

ChatGPT/DALL-E는 수업 자료용으로는 실험 가능하지만 **제품 운영용으로는 부적합**. 원본 보존이 약하기 때문.

---

## 3. AI 입력 JSON 구조

가지 프로젝트의 실제 scene 모델에 맞춘 입력 스키마. `viewer-data.js adaptScenes` 결과와 `storyAnalyzer.js findAllRoutes` 결과를 그대로 활용한다.

### 3-1. 텍스트 AI 입력 (singleScene 단위)

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
    "level": 2
  },
  "scenes": [
    {
      "id": "1", "num": 1, "type": "cover",
      "title": "숲속 이야기",
      "subtitle": "숲속에서 일어나는 동물들의 이야기",
      "kicker": "4학년 1반 작품"
    },
    {
      "id": "2", "num": 2, "type": "normal",
      "title": "",
      "body": "마루와 하루는 길을 가다 멧돼지에게 쫓겼다.",
      "isStart": true,
      "buttons": [
        { "label": "도망간다",     "nextId": "3" },
        { "label": "나무로 숨는다", "nextId": "4" }
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
        { "sceneId": "5", "ending": true }
      ]
    }
  ],
  "context": {
    "previousSceneIds": ["2"],
    "nextSceneIds": ["5", "6"],
    "sceneRoleInRoute": "middle",
    "incomingChoices": [
      { "fromSceneId": "2", "choiceLabel": "도망간다" }
    ],
    "outgoingChoices": [
      { "label": "강을 건넌다", "nextSceneId": "5" },
      { "label": "동굴에 들어간다", "nextSceneId": "6" }
    ]
  },
  "weakConnections": [
    {
      "edge": "2-B → 5",
      "issue": "안 도와줬는데 본인도 잡힘",
      "applyTo": "sceneId 5"
    }
  ],
  "constraints": {
    "doNotChangeSceneCount": true,
    "doNotChangeNextId": true,
    "doNotChangeBranchMeaning": true,
    "preserveStudentVoice": true,
    "preserveLineBreaks": true,
    "preserveProperNouns": ["뇨뇨", "시민", "막대자", "마루", "하루"]
  }
}
```

### 3-2. 가지 scene 모델 ↔ AI 입력 매핑

| 가지 필드 | AI 입력 필드 | 출처 |
|---|---|---|
| `ViewerState.scenes[id]` | `scenes[]` | viewer-data.js adaptScenes |
| `scene.id` (= String(num)) | `id` | adaptScenes |
| `scene.body / title / choices` | 동일 | adaptScenes |
| `storyAnalyzer.findAllRoutes()` | `routes[]` | storyAnalyzer.js |
| `_rtPathHtml` weakConnections (v130) | `weakConnections[]` | storyAnalyzer.js (사전 분석) |

---

## 4. AI 출력 JSON 구조

GPT 재설계안과 Claude 검토 답변을 통합한 최종 스키마.

### 4-1. 텍스트 출력 스키마

```json
{
  "mode": "text",
  "level": 2,
  "targetScope": "singleScene",
  "safeToApply": true,

  "summary": "들어오는 선택지 '도망간다'의 결과를 도입에 반영하고, 다음 분기로 이어질 긴장감을 추가했습니다.",

  "structureCheck": {
    "sceneCountChanged": false,
    "nextIdChanged": false,
    "choiceMeaningChanged": false,
    "newEventAdded": false,
    "coreMeaningChanged": false,
    "lineBreaksPreserved": true,
    "properNounsPreserved": true
  },

  "preservedCheck": {
    "charactersUnchanged": true,
    "plotPointsUnchanged": true,
    "endingDirectionUnchanged": true,
    "branchStructureUnchanged": true
  },

  "sceneEdits": [
    {
      "sceneId": "3",
      "field": "body",
      "original": "둘은 숨을 곳도 없이 계속 뛰었다.",
      "revised": "...",
      "lengthRatio": 2.4,
      "changeLevel": "medium",
      "reason": "들어오는 선택지 '도망간다'의 결과를 도입에 박았고, 추격 상황을 시각화함",
      "preservedCore": "둘이 도망치는 핵심 상황 그대로",

      "additions": {
        "safeAddition": [
          "추격 상황의 시각적 묘사 — 원문 '계속 뛰었다'에서 자연스럽게 추론 가능"
        ],
        "creativeAddition": [
          "마루의 짧은 대사 — 원문에는 없는 AI 해석. 학생 톤에 맞는지 확인 필요"
        ]
      }
    }
  ],

  "choiceEdits": [
    {
      "sceneId": "3",
      "choiceIndex": 0,
      "original": "강을 건넌다",
      "revised": "강을 헤엄쳐 건넌다",
      "changeLevel": "small",
      "reason": "다음 장면(강 한가운데)과 자연스럽게 이어지도록"
    }
  ],

  "warnings": [],
  "riskNotes": [
    "마루의 대사가 학생 작품 톤보다 살짝 직접적일 수 있음 — 1단계로 대체 가능"
  ],

  "doNotAutoApply": true,
  "modelInfo": {
    "model": "claude-sonnet-4-6",
    "tokensUsed": 2840,
    "latencyMs": 6204
  }
}
```

### 4-2. 핵심 — safeAddition vs creativeAddition

이 두 필드는 **2단계 결과의 신뢰도를 구분**하기 위한 핵심 메커니즘이다.

- **safeAddition**: 원문에서 자연스럽게 추론 가능한 보충. UI에서 일반 색으로 표시.
- **creativeAddition**: AI가 해석/추측해서 추가한 내용. UI에서 다른 색(예: 노란 강조)으로 표시 → 사용자에게 "이 부분은 AI 해석"임을 알림.

**예시**

| 원문 | 보충 | 분류 |
|---|---|---|
| "둘은 숨을 곳도 없이 계속 뛰었다" | "숨을 헐떡이며" | safeAddition (자연스러운 추론) |
| "토토와 모찌를 만났다" | "토토는 작은 동물이었고" | creativeAddition (원문에 명시 X — AI 추측) |
| "도와주지 않는다" → 잡혀감 | "밀렵꾼이 길 아는 시민도 노렸다" | safeAddition (인과 보충) |
| "착해졌다" | "밀렵꾼도 마음 깊은 곳에서는 외로웠던 것일지도 모른다" | creativeAddition (감정/내면 해석) |

### 4-3. 이미지 출력 스키마

```json
{
  "mode": "image",
  "level": 2,
  "targetSceneId": "3",
  "safeToApply": true,

  "originalImageUrl": "https://storage.googleapis.com/.../scene_3.png",
  "revisedImageUrl": "https://storage.googleapis.com/.../ai-v1-1737224400.png",

  "modelConfig": {
    "model": "sdxl-img2img",
    "denoisingStrength": 0.5,
    "controlnet": "canny",
    "styleReference": "scene_1_ai_level2.png"
  },

  "preservedCheck": {
    "characterPositionPreserved": true,
    "compositionPreserved": true,
    "colorMoodPreserved": true,
    "handDrawnFeelingPreserved": true,
    "styleConsistencyWithProject": "high"
  },

  "warnings": [],
  "doNotAutoApply": true
}
```

### 4-4. 클라이언트 측 검증 (안전망)

AI가 self-report를 정직하게 못 할 수 있으므로, 다음은 **클라이언트에서 강제 검증**한다.

- `lengthRatio`가 정책 범위 벗어나면 → 재시도
- `sceneEdits[].sceneId`가 존재하지 않는 sceneId면 → 거부
- `choiceEdits[].choiceIndex`가 buttons 범위 초과면 → 거부
- 원본 본문에서 사라진 고유명사(`preserveProperNouns`)가 있으면 → 경고
- `structureCheck` 또는 `preservedCheck` 중 하나라도 false면 → 사용자에게 명시적으로 알림

---

## 5. 사용자에게 보여주는 비교 화면 구조

자세한 HTML 구조는 v1 문서와 동일하므로 핵심만 명시.

- 3열 비교: 원본 / 1단계 / 2단계
- 각 결과 아래: 변경 요약 + safeAddition/creativeAddition 메모
- 액션 버튼: `이 수정 적용` / `적용하지 않기` / `원본 보기`
- 이미지 결과: 동일 구조 (3열 이미지)
- creativeAddition은 본문 내에서 살짝 다른 색으로 inline highlight (선택 사항)

가지 UI 정합: 폰트 `'Jua', sans-serif`, 보라 톤 `#9b4dca`, `white-space: pre-wrap` (v127).

---

## 6. Firebase 읽기 경로

가지 v2 구조 기준. v1 (legacy `teams/${name}`) 호환은 viewer-data.js `basePath` 로직 그대로.

### 6-1. 읽기 (AI 입력 구성용)

```
classes/${classId}/teams/${encodedTeamName}/
  ├─ meta/
  │   └─ isPublic                              # 비공개도 fromMaker/본인 편집은 AI 가능
  ├─ scenes/${num}/
  │   ├─ title / body / buttons / choiceA/B/Count
  │   ├─ nextA / nextB                          # AI 절대 변경 X
  │   ├─ type / isEnding / trueEnding
  │   ├─ subtitle / kicker                      # cover only
  │   └─ imageData OR imageStorageUrl
  ├─ viewer-meta/
  │   └─ entrySceneId / replaySceneId
  └─ locks/${num}/                              # AI 적용 시 잠금 확인
```

### 6-2. 추가 노드 — **설계 후보** (지금 만들지 않음)

> ⚠️ 아래 노드는 **설계 후보**일 뿐이다. 실제 Firebase에 만드는 건 Phase A 구현 단계에서 사용자가 정책 결정 후 다시 확정. 필드명·구조는 변경될 수 있다.

```
classes/${classId}/teams/${encodedTeamName}/
  ├─ ai-suggestions/${suggestionId}/            # AI 결과 (적용 전)
  │   ├─ mode / level / targetSceneId
  │   ├─ requestedBy: {uid, role, requestedAt}
  │   ├─ result: { ...output JSON... }
  │   ├─ status: "pending" | "accepted" | "rejected" | "expired"
  │   └─ ttl: timestamp                          # 24시간 후 자동 만료
  │
  ├─ ai-history/${sceneId}/${historyId}/         # 원본 백업 (수락 직전 스냅샷)
  │   ├─ before / after
  │   ├─ suggestionId / acceptedAt / revertedAt
  │
  └─ ai-context/                                 # 작품 단위 캐시 (이미지 일관성)
      ├─ characters / settings / mood
      └─ styleAnchorImageUrl
```

### 6-3. Storage 경로 (이미지 AI 결과) — **설계 후보**

```
ai-results/classes/${classId}/teams/${teamName}/scenes/${num}/
  ├─ ai-v${version}-${timestamp}.png
  └─ original-${timestamp}.png      # 적용 시 백업
```

base64 절대 RTDB에 박지 않는다 (v113 정책).

---

## 7. 원본 보존 / 적용 / 되돌리기 설계

### 7-1. 전체 흐름 (텍스트)

```
1. 사용자가 인스펙터에서 [🤖 AI 다듬기 (강도 1)] 클릭
2. 클라이언트가 입력 JSON 구성
   - ViewerState.scenes → adaptScenes
   - storyAnalyzer.findAllRoutes
   - 사전 약한 연결 분석
3. Cloud Functions로 요청 → Claude API 호출
4. 결과 JSON 받음 → 클라이언트 검증 (4-4 차단 조건)
5. ai-suggestions/${suggestionId} 노드에 저장 (status: "pending", ttl: +24h)
6. 비교 미리보기 열림
7. 사용자가 [적용]:
   a. 잠금 확인 (viewerEnsureEditable)
   b. ai-history/${sceneId}/${historyId} 박음 (before/after 스냅샷)
   c. saveSceneText(num, { body, title, buttons, choiceA, choiceB }) 호출
   d. ai-suggestions status: "accepted"
   e. _patchSceneBody / _scheduleViewerFrameReRender (v130 동기 흐름)
8. 사용자가 [되돌리기] (history 화면에서):
   a. ai-history에서 before 읽음
   b. saveSceneText(num, before)
   c. ai-history revertedAt 기록
```

### 7-2. 핵심 원칙

- 원본 절대 자동 덮어쓰기 X — ai-history에 before 스냅샷 필수
- 수락 시점에만 saveSceneText 호출
- 잠금 박힌 상태에서만 수락 가능 (v129 readonly 정책)
- suggestionId TTL 24시간 — 미수락 결과 자동 정리 (RTDB 비용 보호)
- 본문 줄바꿈 보존 (v127)
- buttons + choiceA/B 동시 저장 (v130 _rtSaveChoiceLabel 패턴)

### 7-3. 재사용할 가지 함수

새 저장 함수를 만들지 않는다. 기존 함수를 그대로 활용한다.

- `viewer-data.js saveSceneText(num, fields)` — RTDB patch (ALLOWED)
- `viewer-edit.js _queueSave(num, fields)` — debounce + 잠금 heartbeat
- `viewer-edit.js _patchSceneBody(value)` — viewer-frame 부분 patch
- `viewer-edit.js _scheduleViewerFrameReRender()` — 통째 재렌더
- `viewer-locks.js viewerEnsureEditable(num)` — 잠금 확보
- `storyAnalyzer.js _rtSyncSceneField(num, field, value)` — 메모리 동기 (v130)

AI 적용 함수 = 위 함수들을 묶은 wrapper (`_aiApplySuggestion(suggestionId)`).

---

## 8. 비용·quota — 단계별 정책

### 8-1. 비용 추정

| 구분 | 모델 | 비용/요청 | 한국어 환산 |
|---|---|---|---|
| 텍스트 1단계 | Claude Haiku 4.5 | ~$0.001 | 약 1원 |
| 텍스트 2단계 | Claude Sonnet 4.6 | ~$0.005 | 약 7원 |
| 이미지 1단계 | SDXL img2img | ~$0.01 ~ $0.03 | 약 15~40원 |
| 이미지 2단계 | SDXL img2img + ControlNet | ~$0.02 ~ $0.04 | 약 30~55원 |
| 작품 자동 생성 | Sonnet 4.6 | ~$0.25 | 약 300원 |

### 8-2. quota 정책 — **단계별로 다르게 적용**

**Phase 1 — 베타/초기 운영 (가장 엄격)**

```
텍스트
- 작품(팀)당 1단계 1회
- 작품(팀)당 2단계 1회
- 동일 장면 재생성 X

이미지
- 작품당 1단계 1회 (장면 자유 선택)
- 작품당 2단계 1회 (장면 자유 선택)
- 또는 1차 베타에서는 이미지 자체 비활성

클래스 단위
- 일일 텍스트 100회 한도
- 일일 이미지 30회 한도

전체 운영 단위
- 일일 텍스트 5,000회
- 일일 이미지 500회
- 비상 차단 스위치 (Cloud Functions 한 줄로 강제 종료)
```

이유:
- 비용 위험 최소
- 학생이 신중하게 선택
- AI 의존 차단
- 운영자가 패턴 관찰 가능

**Phase 2 — 안정화 이후 (확장)**

```
텍스트
- 작품 총량: 1단계 5회, 2단계 5회
- 동일 장면당 강도별 1회 제한
- 재생성은 1회 추가만 허용

이미지
- 장면당 1단계 1회, 2단계 1회
- 작품 총량 이미지 10장 제한
- 재생성은 교사 승인 또는 별도 권한

학생/교사 권한 분리
- 학생 자율 = 텍스트 강도 1만
- 텍스트 강도 2 = 학생 신청 → 교사 승인
- 이미지 = 교사 승인 후만
```

이유:
- 운영 데이터 축적 후 합리적 확장
- 학생 학습 자율성 확장
- 비용은 여전히 통제 가능

### 8-3. 3단 방어 (모든 단계 공통)

quota 강제는 세 곳에서 동시에 한다.

1. **클라이언트 단**: 횟수 카운터 표시 ("강도 1 남음: 0회")
2. **Functions 단**: RTDB 카운터로 강제 차단 (클라이언트 조작 방지)
3. **API 단**: Anthropic console / Replicate에서 월 한도 설정 ($50 도달 시 자동 차단)

### 8-4. v113 만원 사건 교훈 반영

- AI 이미지 결과 = Storage URL만 RTDB 저장. base64 절대 금지
- AI suggestion 결과 = 텍스트만 RTDB. 큰 결과(>10KB)는 Storage로
- ai-history before/after = 본문만 (텍스트 KB 단위)
- TTL 24시간 — 미수락 결과 자동 정리

### 8-5. 보안

- Claude API key 클라이언트 절대 노출 X
- Cloud Functions 서버사이드만 사용 — 환경변수 또는 Secret Manager
- Functions endpoint 인증 — Firebase ID token 검증 + role 검사
- 학생당 분당 1회, 30초 쿨다운 (클릭 연타 차단)

---

## 9. 구현 시 필요한 파일 후보

### 9-1. 신규 파일

| 파일 | 역할 | 우선순위 |
|---|---|---|
| `functions/index.js` | Cloud Functions entry | 1 |
| `functions/lib/claudePrompts.js` | 시스템 + 강도별 프롬프트 (체크리스트 포함) | 1 |
| `functions/lib/imagePrompts.js` | 이미지 1단계/2단계 프롬프트 + 모델 설정 | 2 |
| `functions/lib/quota.js` | RTDB counter ratelimit | 1 |
| `functions/lib/validators.js` | 출력 JSON 검증 (4-4 차단 조건) | 1 |
| `viewer-ai.js` | 클라이언트 진입 — 입력 JSON 구성, Functions 호출 | 1 |
| `viewer-ai-preview.js` | 비교 미리보기 + accept/reject | 1 |
| `viewer-ai-history.js` | ai-history 노드 — 되돌리기 UI | 2 |
| `viewer-ai-ui.css` | AI 비교 화면 / 버튼 / 배지 | 1 |

### 9-2. 수정 파일

| 파일 | 변경 |
|---|---|
| `viewer.html` | viewer-ai.js / viewer-ai-preview.js / CSS 로드 |
| `viewer-edit.js _textEditHtml` | [🤖 AI 다듬기 (강도 1)] / [🤖 AI 발전 (강도 2)] 버튼 |
| `viewer-data.js saveSceneText ALLOWED` | 변경 없음 (기존 필드 그대로 사용) |
| `database.rules.json` | `ai-suggestions/`, `ai-history/`, `ai-context/` 노드 rules |
| `mobileTextBranch.js` | 모바일 텍스트형 AI 진입 (3순위) |
| `firebase.json` | Functions 배포 설정 |

### 9-3. 재사용 함수 (새로 만들지 않음)

`saveSceneText`, `_queueSave`, `_patchSceneBody`, `_scheduleViewerFrameReRender`, `viewerEnsureEditable`, `_rtSyncSceneField`, `findAllRoutes`, `adaptScenes`.

---

## 10. 구현 우선순위

### Phase A — 인프라 (가장 작은 시작)
1. Firebase Functions 설정 + 배포 환경
2. Claude API key 등록 (Secret Manager)
3. `aiTextSuggest` Functions endpoint (**강도 1만**)
4. `viewer-ai.js` 기본 — 입력 JSON + Functions 호출
5. `ai-suggestions` 노드 + rules

### Phase B — UI
6. `viewer-ai-preview.js` 비교 화면
7. `viewer-edit.js`에 강도 1 버튼
8. accept/reject 흐름 + `saveSceneText` 호출
9. **1개 베타 클래스에서 테스트** (위험 격리)

### Phase C — 안전망
10. ai-history 백업 + 되돌리기 UI
11. quota 도달 안내
12. admin 사용량 대시보드
13. 비정상 패턴 모니터링

### Phase D — 강도 2 + 이미지
14. 텍스트 강도 2 (구조 분석 포함)
15. ai-context 사전 분석 (이미지 일관성용)
16. 이미지 강도 1 (SDXL img2img low strength)
17. 이미지 강도 2 (SDXL img2img medium + ControlNet)
18. Storage 결과 URL 흐름

### Phase E — 통합
19. 모바일 텍스트형 AI 진입
20. 루트보기 일괄 검증
21. 운영 데이터 기반 quota 확장 (Phase 2 정책)

### MVP 정의

**Phase A + B + 가장 최소한의 C** = MVP.

- 텍스트 강도 1만
- 인스펙터 본문 옆 버튼
- 비교 화면 → 적용 / 보류
- ai-suggestions + ai-history
- 학생 작품당 1회 quota
- 1개 베타 클래스

이미지·강도 2는 MVP 이후.

---

## 11. Phase 0 결정문

> Phase A(실제 구현)에 들어가기 전 사용자가 정해야 할 정책. 결정문이 채워진 후에만 Phase A 진행.

### 11-1. 정책 초안 (v2)

> AI 기능 1차 구현 정책
>
> 1. 1차 구현은 **텍스트 AI 강도 1만** 한다.
> 2. AI 결과는 **비교 미리보기**로만 보여준다. 자동 적용 X.
> 3. 적용은 **잠금 상태에서만** 가능 (다른 친구가 수정 중이 아닐 때).
> 4. **이미지 AI는 아직 구현하지 않는다**.
> 5. API 호출은 **Cloud Functions를 통해서만** 한다.
> 6. quota는 **작품당 강도별 1회** (Phase 1 정책).
> 7. quota 적용 전에는 학생에게 공개하지 않는다.
> 8. 1개 베타 클래스에서 먼저 운영.

### 11-2. 사용자가 결정할 항목

| # | 항목 | 선택지 | 확정 |
|---|---|---|---|
| 1 | **공개수업 모드** (있다면) | 교사 시연형 / 학생 체험형 | ☐ |
| 2 | **1차 범위** | 텍스트 강도 1만 / 강도 1+2 / 이미지 포함 | ☐ |
| 3 | **자동 적용** | 자동 X (확인 화면) / 강도 1만 자동 | ☐ |
| 4 | **적용 권한** | 학생 본인 / 교사 / 둘 다 | ☐ |
| 5 | **API 구조** | Cloud Functions / 다른 방식 | ☐ |
| 6 | **텍스트 모델** | Haiku 4.5 (저렴) / Sonnet 4.6 (품질) / 강도별 분리 | ☐ |
| 7 | **이미지 모델** (Phase D) | SDXL / Imagen / Flux / 박지 X | ☐ |
| 8 | **quota — Phase 1** | 작품당 1회 / 다른 값 | ☐ |
| 9 | **quota — Phase 2 확장 기준** | 운영 N개월 후 / 사용 패턴 검토 후 | ☐ |
| 10 | **빌링 책임자** | 학교 / 교사 개인 / 가지 운영자 | ☐ |
| 11 | **베타 클래스** | 1개만 / 여러 개 / 운영 시작부터 전체 | ☐ |
| 12 | **학부모 동의** | 명시 동의 박힌 후만 / 학교 일괄 동의 / 박지 X | ☐ |
| 13 | **AI 결과 보관** | TTL 24h / 30일 / 영구 | ☐ |
| 14 | **v1 → v2 텍스트 결과 재생성** | 체크리스트 기준으로 재실험 박을지 / 박지 X | ☐ |

### 11-3. 사용자 확정 결정 (박을 자리)

```
결정 박은 날: YYYY-MM-DD
박은 사람: dobuk

1. 공개수업 모드: __________
2. 1차 범위: __________
3. ...
```

### 11-4. Phase A 진행 조건

다음 항목 모두 충족 후 Phase A 시작.

- [ ] 11-2 14개 항목 모두 결정
- [ ] 학부모/학교 동의 (외부 AI 사용)
- [ ] Firebase 결제 알람 (v113 재발 방지)
- [ ] Anthropic / Replicate 월 한도 설정
- [ ] 베타 클래스 1개 지정
- [ ] 비상 차단 스위치 위치 정함

### 11-5. Phase 0 단계 — 박지 않을 것

- 실제 Firebase에 `ai-suggestions/`/`ai-history/`/`ai-context/` 노드 생성 X
- Firebase rules 변경 X
- Cloud Functions 배포 X
- Claude API key 등록 X
- viewer-edit.js에 AI 버튼 추가 X
- maker.html에 AI 버튼 추가 X
- mobileTextBranch.js에 AI 진입 추가 X

설계 문서 작성 + Phase 0 결정문 채움. 그 외는 모두 Phase A부터.

---

## 부록 A — 모델 선택 권장

### 텍스트
- **강도 1**: Claude Haiku 4.5 — 빠름·저렴 (약 $0.001/요청). 맞춤법·문장 정리 충분.
- **강도 2**: Claude Sonnet 4.6 — 분기 일관성 검증에 추론 능력 필요 (약 $0.005/요청).

### 이미지
- **강도 1**: SDXL img2img + ControlNet canny (Replicate). denoising 0.20~0.30.
- **강도 2**: SDXL img2img + ControlNet + IP-Adapter (style reference). denoising 0.45~0.55.
- 대안: Imagen 3 (Google) — 한국어 프롬프트 좋음, style reference 강함.
- 비추천 (제품용): DALL-E 3 — 원본 보존이 약함. 수업 시연용으로만.

---

## 부록 B — 가지 코드 위치 빠른 참조

- 작품 데이터 로드: `viewer-data.js loadTeamData()`
- 장면 정규화: `viewer-data.js adaptScenes()`
- 장면 저장: `viewer-data.js saveSceneText(num, fields)`
- 잠금: `viewer-locks.js viewerEnsureEditable(num)`
- 본문 patch: `viewer-edit.js _patchSceneBody(value)`
- 통째 재렌더: `viewer-edit.js _scheduleViewerFrameReRender()`
- 루트 분석: `storyAnalyzer.js findAllRoutes(startNum)`
- 인라인 수정 패턴 (v130): `storyAnalyzer.js _rtSaveBody/_rtSaveChoiceLabel`
- 인스펙터 본문 입력: `viewer-edit.js _textEditHtml`
- 모바일 텍스트형 편집: `mobileTextBranch.js _mtbOpenEditScene`

---

## 부록 C — 다음 세션 가이드

이 문서는 **설계 문서**이며 코드 변경은 없다. AI 기능 실제 구현 시:

1. 이 문서 + `project_branch_ai_design.md` 메모리 두 가지 모두 확인
2. **[11. Phase 0 결정문] 박혀있는지 확인** — 박혀있지 않으면 Phase A 진행 X
3. Phase A부터 순서대로
4. 각 Phase 후 사용자 검증
5. v113 만원 사건 교훈 항상 적용 — 비용 모니터링 우선
6. 새 저장 함수 만들지 X — 기존 `saveSceneText` + `_queueSave` 재사용
7. 본문 줄바꿈(v127), 잠금(v129), 인라인 동기(v130) 정책 모두 정합
8. [6-2 / 6-3] 신설 노드 = 설계 후보 — 실제 만들 때 다시 확정

---

**문서 버전**: v2 (2026-05-18)
**v2 변경 핵심**:
- 수업자료 맥락 완전 제거 (제품 기능 기준만)
- 1단계 = "안심하고 받을 수 있는 정돈", 2단계 = "매력적이지만 판단이 필요한 발전" 정체성 명확화
- 변화 폭 % 대신 허용/금지 행동 체크리스트 도입
- 1단계는 새 문장 추가 금지 / 2단계는 구조 분석 필수
- 출력 JSON에 safeAddition / creativeAddition 구분 추가
- 이미지 1·2단계는 모델/파라미터(denoising strength, ControlNet, style reference) 기반
- quota를 Phase 1(작품당 1회) / Phase 2(장면당 + 총량) 두 단계로 분리

**다음 갱신**: Phase 0 결정문 14개 항목 채워진 후 또는 Phase A 진행 시.
