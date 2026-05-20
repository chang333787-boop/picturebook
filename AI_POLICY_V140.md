# 가지 AI — v140 정책 (운영/테스트 분리 + 원본 보존 + lineage)

> 시점: 2026-05-20
> 상태: **v140 정책 박음** — 사용자 명시 (운영/테스트 분리, 원본 마감, 교사 허용제, copyDepth, aiVariants 토글, 1단계 후보 3회)
> 이전: `AI_MASTER_PLAN_CLAUDE_v3.md` (v3 합의안 — 일부 흐름 폐기)
> 코드 변경 X — 설계 정합성 박힌 거

---

# 0. 가장 중요한 전제

**운영 정책 ↔ 테스트 정책 분리**.

운영 모드에서는 AI 안전정책을 강하게 적용. 단 Phase 0.5 mock / 개발 테스트 단계는 원본 마감 조건·quota 박힌 거 박혀 화면 검증이 막히면 안 됨.

## 0-1. 운영 모드 (실 학생 사용)

- 원본 최종 마감 후 AI 가능
- 교사 AI 허용 ON 필요
- `copyDepth` 0/1까지만 AI 가능
- quota 적용
- `contentLockedByAi` 적용
- Functions 서버 검증 필수

## 0-2. 개발/교사 테스트 모드 (Phase 0.5 mock)

- 원본 최종 마감 조건 임시 우회 가능
- mock quota는 reset 가능해야 박힘
- mock quota는 실 비용 X — 테스트 중 완화·비활성화 가능
- AI 버튼을 테스트 목적으로 표시 가능
- 화면에 **TEST MODE** 또는 **개발 테스트 모드** 표시 필수
- 실제 학생 데이터에는 사용 X
- 실 API 호출에는 이 우회 정책 절대 적용 X

## 0-3. mock 테스트 편의 보정

- `mockUsage`와 `realUsage` 분리
- mock quota는 localStorage 기반 — 쉽게 reset 가능
- 테스트 함수 제공: `window.__resetAiMockUsage()` 또는 [테스트 quota 초기화] 버튼
- mock quota 박혀 UI 검증 막히면 안 됨

## 0-4. finalization 우회

- 운영: 원본 최종 마감 필수
- mock 테스트: `[TEST]` 원본 최종 마감 상태로 가정하고 AI 테스트 가능
- 우회는 문서·UI에서 **테스트 전용** 명확히 표시

---

# 1. 원본 최종 마감 원칙 (운영)

AI 정돈/발전 기능은 **최종 마감된 원본 작품**에서만 실행 가능.

## 1-1. 정책
- 마감 전 AI 정돈/발전 버튼 비활성화
- AI 사용 전 "원본 최종 마감" 확인 모달
- 마감 후 막을 거:
  - 본문 수정
  - 장면 추가/삭제
  - 선택지 문구
  - 선택지 연결
  - 원본 이미지 삭제/교체
- 마감 후 허용할 거:
  - 카드 스타일·색계열·톤·글자 크기·폰트 등 디자인/연출 조정
- 원본을 다시 수정하고 싶으면 새 브랜치/새 파일로 시작
- 초기 버전에서는 마감 후 원본 수정 예외 만들지 X

## 1-2. 안내 문구

> AI는 완성된 작품을 다듬는 기능입니다.
> AI를 사용하려면 먼저 원본 작품을 최종 마감해야 합니다.
> 최종 마감 후에는 본문, 장면 수, 선택지, 연결 구조를 수정할 수 없습니다.
> 색, 톤, 카드 스타일, 글자 크기 같은 보기 설정은 계속 조정할 수 있습니다.
> 아직 내용을 고쳐야 한다면 AI를 사용하지 말고 작품을 더 완성해 주세요.

버튼:
- `[원본 최종 마감하고 AI 사용하기]`
- `[아직 더 수정할래요]`

## 1-3. 테스트 모드 예외

Phase 0.5 mock 테스트에서는 테스트 모드로 임시 우회 가능. 우회 시 화면에 `TEST MODE — 원본 마감 우회` 라벨 표시.

---

# 2. 교사 AI 허용제

AI 기능은 기본값 OFF. 교사가 브랜치 설정에서 AI 사용을 ON 박혀야 활성화.

## 2-1. 정책
- 기본값 OFF
- 교사가 브랜치 설정에서 AI 사용 ON
- 허용된 브랜치에서만 AI 버튼 활성화
- 클라이언트 버튼 비활성화는 보조
- **Functions에서 `aiPermission.enabled` 반드시 검증**

## 2-2. metadata 예

```js
aiPermission: {
  enabled: true,
  enabledBy: "teacher",
  enabledAt: 1234567890,
  allowChildBranches: true,
  allowedModes: {
    textS1: true,
    workCheck: true,
    textS2: false,
    textS3: false,
    imageAi: false
  }
}
```

## 2-3. 학생 UI 문구

> AI 기능은 선생님이 허용한 작품에서만 사용할 수 있어요.

---

# 3. 브랜치 lineage / 복사 정책

수업에서 교사가 기본 구조를 잡아준 뒤, 그 브랜치를 여러 개 복사해 학생/모둠에게 나눠주는 경우. 모 브랜치 1차 복사본까지 AI 가능. 자식 브랜치에서 다시 복사한 손자 브랜치부터 AI 금지 + 손자 브랜치 생성 자체 금지.

## 3-1. copyDepth 정의

| depth | 역할 | AI |
|---|---|---|
| 0 | 모 브랜치 (root) | ✓ |
| 1 | 자식 브랜치 (student_child) | ✓ |
| 2+ | 손자 이상 | ❌ |

## 3-2. 복사 제한
- `copyDepth 0` 브랜치만 복사 가능
- `copyDepth 1` 브랜치는 복사 버튼 비활성화
- 손자 브랜치 생성 X
- 예외적으로 `copyDepth 2+` 데이터 박혀있으면 AI 버튼 비활성화

## 3-3. 교사용 복사 UX
- 모 브랜치에서 `[학생용 복사본 만들기]` 버튼
- "몇 개 복사할까요?" 입력
- 예: 5개 입력 시 자식 브랜치 1~5 생성
- 한 번에 생성 가능 개수 제한. 초기 추천 **최대 10개**

## 3-4. metadata 예

### 모 브랜치
```js
branchLineage: {
  rootBranchId: "...",
  parentBranchId: null,
  copyDepth: 0,
  copyRole: "root",
  aiAllowed: true,
  canCopyAgain: true
}
```

### 자식 브랜치
```js
branchLineage: {
  rootBranchId: "...",
  parentBranchId: "...",
  copyDepth: 1,
  copyRole: "student_child",
  aiAllowed: true,
  canCopyAgain: false
}
```

---

# 4. AI 저장 방식 — aiVariants 토글

AI 결과를 현재 작품 `body`에 **덮어쓰는 구조 폐기**. AI 결과는 같은 브랜치 안의 `aiVariants`에 저장, 사용자는 원본/AI 버전을 토글로 비교.

## 4-1. 정책
- AI 결과를 새 복사본으로 만들지 X
- 원본 `body`/`image` 덮어쓰지 X
- AI 결과는 `scenes/{sceneId}/aiVariants` 또는 work-level `aiVariants`에 저장
- 사용자는 `[원본] [AI 1단계] [AI 2단계] [AI 이미지]` 토글로 비교
- 감상 화면·다듬기 화면은 `aiViewMode`에 따라 원본 또는 AI variant 표시

## 4-2. 기존 흐름 폐기

| 옛 (v3 / v139 mock) | 새 (v140) |
|---|---|
| AI 결과 → `_rtSaveBody`로 현재 본문 덮어쓰기 | AI 결과 → `aiDrafts` 저장 → 후보 선택 → 미세 수정 → 단계 마감 → `aiVariants.final` |

## 4-3. 저장 흐름 분리

- `_rtSaveBody` — **원본 편집 전용**으로 유지
- AI variant 저장은 **별도 저장 흐름** 사용 (예: `_rtSaveAiVariant`)

---

# 5. 텍스트 1단계 새 흐름

큰 내용 변화가 아니므로 "후보 생성 → 선택 → 미세 수정 → 최종 마감".

## 5-1. 정책
- 브랜치당 최대 **3회 생성** 가능
- 1회 = 1회차 후보 / 2회 = 1·2회차 / 3회 = 1·2·3회차 함께 표시
- 사용자는 원하는 회차 후보 선택
- 선택 후 "AI 1단계 편집 중" 상태
- 편집 중 본문 미세 수정 가능
- 수정 범위: 맞춤법·띄어쓰기·조사·어색한 문장 연결
- 새 사건·새 인물·새 대사·새 배경·새 감정 추가는 1단계 취지와 안 맞는다고 안내
- `[AI 1단계 저장/마감]` → `aiVariants.textS1.final` 저장
- 마감 후 AI 1단계 본문 잠금, 디자인 조정만 가능
- 원본 `body` 덮어쓰지 X
- 원본/AI 1단계 토글로 비교

## 5-2. 상태값

`aiTextS1Status`:
- `none`
- `generating`
- `candidate_ready`
- `drafting`
- `finalized`

## 5-3. 저장 구조

```js
aiDrafts.textS1 = {
  candidates: {
    attempt1: { ... },
    attempt2: { ... },
    attempt3: { ... }
  },
  selectedAttempt: 2,
  editedDraftByScene: { ... }
}

aiVariants.textS1 = {
  status: "finalized",
  final: { ... },
  finalizedAt: 1234567890
}
```

## 5-4. TTL
- 후보 3개 = 임시 draft
- 최종 마감 후 1개만 `aiVariants` 저장
- 후보는 TTL 또는 마감 후 정리

---

# 6. 작품 검사

`prompts/work-check.md v3` 유지. 작품 검사 = 진단 (수정 X).

## 6-1. 결정 필요 (보류 항목)
- 작품 검사를 **최종 마감 전에도 허용할지** vs **마감 후에만 허용할지**

## 6-2. 추천 (사용자 결정 박힘)
- 작품 검사 = 마감 전 가능 (진단만이라 안전)
- AI 정돈/발전 = 마감 후 가능

이유: 검사는 수정 X — 학생이 완성 전 점검용으로 사용 가능.

단 사용자가 원하면 작품 검사도 마감 후로 묶을 수 있게 보류 항목 유지.

---

# 7. 이미지 AI

이미지 AI도 `aiVariants` 안 저장.

## 7-1. 절대 원칙
- 분할형/그림 중심형 이미지 **영역 크기·비율 절대 수정 X**
- AI 이미지가 기존 칸에 맞춰 들어와야 박힘
- 원본 이미지를 가로/세로로 억지로 늘리지 X
- 비율 맞으면 확대/crop로 맞춤
- 부족 영역은 학생 그림 배경을 자연스럽게 연장하는 방식 (`cover_with_outpaint`)
- 핵심 캐릭터/중심 대상은 자르거나 변형 X
- 원본 스케치/이미지 보존
- 미적용 이미지 후보는 TTL로 삭제
- 적용된 AI 이미지 1개만 토글 대상으로 남기는 방향이 기본

## 7-2. 저장 예

```js
aiVariants.imageAi = {
  status: "finalized",
  imageByScene: {
    "1": {
      imageUrl: "...",
      baseImageUrl: "...",
      baseImageHash: "...",
      fitPolicy: "cover_with_outpaint",
      finalizedAt: 1234567890
    }
  }
}
```

## 7-3. 별도 제한
- 이미지 AI는 텍스트보다 비용·저장 위험 큼
- 장면당 1~2회 또는 작품당 총 N회로 별도 제한
- Storage 비용 별도 모니터링

---

# 8. quota / 비용 방어

교사 계정 제한이 아직 없어 완전한 무한 사용 방지는 X. 다층 방어로 박음.

## 8-1. 방어선 (8단)
1. 교사 AI 허용 ON/OFF
2. `copyDepth 0~1`까지만 AI 가능
3. 자식 브랜치 재복사 금지
4. 브랜치별 quota
5. `rootBranchId` 묶음 quota
6. Functions 일일/월간 hard cap
7. Anthropic 콘솔 비용 한도
8. 추후 `teacherId` 계정 체계가 생기면 `teacherId` quota 추가

## 8-2. 권장 quota
- 텍스트 1단계: **브랜치당 최대 3회 생성**
- 작품 검사: 브랜치당 5회
- `rootBranchId` 기준 하루 전체 AI 호출 최대 N회
- 이미지 AI는 별도 — 장면당 1~2회 또는 작품당 총 N회

## 8-3. 서버 검증 (Functions 필수)
- `aiPermission.enabled`
- `copyDepth <= 1`
- quota 남음
- `rootBranchId` quota 남음
- `contentLocked` 상태 충돌 X
- **실 API 테스트/운영에서 `testMode` 우회 불가**

---

# 9. v3 / v139 mock과 달라진 점 (정리)

| 항목 | v3 (옛) | v140 (새) |
|---|---|---|
| AI 결과 적용 | `_rtSaveBody` 원본 덮어쓰기 | `aiVariants.final` 별도 저장 + 토글 |
| 원본 마감 | X | 운영 필수 |
| 교사 허용 | X (전 작품 가능) | 기본 OFF, 교사 ON 박혀야 |
| 브랜치 복사 | 자유 | `copyDepth 0/1`까지만 AI, 자식 재복사 X |
| 1단계 흐름 | 1회 호출 → 1 결과 → 즉시 적용 | 최대 3회 후보 → 선택 → 미세 수정 → 마감 |
| 운영/테스트 모드 | 구분 X | 분리 — mock 테스트는 마감/quota 우회 가능 |
| mock quota | 7가지 환불 (차감 그대로) | reset 가능 (`window.__resetAiMockUsage`) |

---

# 10. 새 결정 항목 (보류 — 사용자 결정 박힘)

| # | 항목 | 추천 |
|---|---|---|
| A | 작품 검사 마감 전/후 허용 | 마감 전 가능 (진단만) — 단 보류 유지 |
| B | `rootBranchId` 묶음 quota 값 | 하루 N회 — 베타에서 결정 |
| C | 한 번에 생성 가능 복사본 개수 | 최대 10개 (초기) |
| D | 이미지 AI 장면당 quota | 1~2회 (Phase D·E에서) |
| E | `aiDrafts` TTL 기간 | 마감 후 24h? 7일? 결정 박힘 |
| F | testMode 진입 조건 (교사 계정만? URL ?test=1?) | 결정 박힘 |

---

# 11. 코드 X (이번 작업 박힌 거)

이 문서 박은 시점에 다음은 박지 X:
- Phase A 실 API 구현
- API key 추가
- Anthropic/OpenAI/Gemini 연결
- Functions 실 API 연결
- viewer 본기능 구현
- CSS 본기능 구현
- 비용 발생 작업

박을 수 있는 거:
- 문서 업데이트
- mock 테스트 편의 보정 설계
- Phase 0.5 mock 테스트 편의용 reset 안내 정도
