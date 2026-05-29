# 관리모드 상태 정리 — 2026-05

## 0. 문서 목적

- 관리모드 1~4차 개선 완료 내용 정리
- 현재 구조에서 의도적으로 하지 않은 기능 정리
- 학생 계정 / 비밀번호 / 최근 수정 시간 관련 후순위 이유 정리
- 마감 안정화 단계에서 다음 작업자가 안전하게 이어가기 위한 기준 제공

---

## 1. 현재 관리모드의 기본 구조

- **교사**: Firebase Auth Email/Password 가입·로그인 (`teacher-auth.html`)
- **학생**: Firebase **익명 Auth** + **팀명 문자열** 기반. 학생 계정 개념 자체가 없음
- 관리모드는 `teacher-auth.html`(진입) + `adminConsole.js`(콘솔) 중심
- 데이터 경로 v2: `classes/{classId}/teams/{encodedName}/...`
- 학생 계정 / 비밀번호 모델은 **현재 없음** — 의도된 모델

---

## 2. 관리모드 1차 완료

- commit: `0417029 Harden admin console safety`
- 작업 내역:
  - **팀 삭제 강한 확인** — `confirm()` 이후 `prompt()`로 팀명 정확 입력해야 `remove()` 호출
    - 취소 / 빈 값 / 불일치 시 Firebase 호출 경로 차단
  - **팀 카드에 작품 모드 배지** — `viewer-meta/projectType`을 4종 화이트리스트(`picturebook` / `text` / `movie` / `experience`)와 비교해 한국어 라벨로 표시. 미선택 / 알 수 없는 값은 별도 처리
  - **`.claude/` 개인 설정 ignore** — `.gitignore`에 `.claude/` 추가. 개인 Claude Code 권한 설정이 실수로 commit되지 않도록 보호

---

## 3. 관리모드 2차 완료

- commit: `f3d2e94 Improve admin filtering and delete errors`
- 작업 내역:
  - **`PERMISSION_DENIED` 친화 메시지** — Firebase Rules에 의해 삭제가 거부될 때 원문 에러 대신 교사가 이해할 수 있는 안내. 권한을 열거나 Rules를 수정하지 않음
  - **모드별 필터** — 전체 모드 / 그림책 / 텍스트 / 무비 / 체험전시 / 미선택
  - **상태 × 모드 AND 필터** — 기존 상태 필터(전체 / 확인 필요 / 작업 중 / 감상 가능 / 미시작)와 새 모드 필터가 함께 적용됨. 필터 상태는 메모리에만 보관

---

## 4. 관리모드 3차 완료

- commit: `6fcb50c Show unconnected admin choices`
- 작업 내역:
  - **`_unconnectedButtonsCount(s)` 헬퍼 추가** — 한 장면의 미연결 행동 버튼 수 계산
    - 표지 / 엔딩은 제외
    - `buttons[]` 배열을 우선 사용 (Phase 4-C 정책과 정합)
    - legacy fallback도 지원
  - **`_analyzeTeam`에 `unconnectedButtons` 집계 추가** — 작품 전체 미연결 버튼 합계
  - **카드 배지 표시** — `🔗 미연결 버튼 N개` (1 이상일 때만 표시, 0이면 표시하지 않음)
  - **문제 진단 목록에 반영** — `_listProblems`에 `미연결 버튼 N개` 항목 추가
- 저장 구조 / Firebase 쓰기 변경 없음 (읽기 전용 분석)

---

## 5. 관리모드 3차 보정

- commit: `370c9b8 Refine admin unconnected choice count`
- 작업 내역:
  - **legacy fallback의 `choiceCount` 기본값 2 제거**
  - 변경 후 동작:
    - `buttons[]`가 있으면 그 배열 기준 (현재 표준)
    - `buttons[]`가 없고 `choiceCount`가 숫자로 명시되어 있으면 `nextA` / `nextB` fallback
    - `buttons[]`도 없고 `choiceCount`도 없으면 **0으로 처리**
- 효과:
  - 빈 장면 / 옛 장면이 미연결 버튼 2개로 과표시되는 위험 완화
  - 화이트리스트 작품(`class_2026_junglim_1`)의 실제 데이터 확인 결과, 모든 장면이 `buttons[]`를 가지고 있어 이번 보정의 영향은 제한적이지만 안전망으로 유지

---

## 6. 관리모드 4차 완료

- commit: `417951d Improve admin issue sorting`
- 작업 내역:
  - **"문제 우선" 정렬 5단계 우선순위**
    1. status (`needs-attention` → `in-progress` → `not-started` → `ready`)
    2. `unconnectedButtons` 많은 팀이 먼저
    3. `problems.length` 많은 팀이 먼저
    4. `isolated` 많은 팀이 먼저
    5. `connectivity` 낮은 팀이 먼저
    - 동률은 이름순(`localeCompare('ko')`)
  - 이름순 / 장면 수 정렬은 기존 동작 그대로 유지
  - 상태 필터 / 모드 필터 적용 후 정렬되는 흐름 유지
  - `undefined` 안전망 포함

---

## 7. 현재 관리모드에서 볼 수 있는 정보

카드 헤더:
- 팀명
- 상태 배지 (4종)
- 작품 모드 배지 (4종 + 미선택)
- 진엔딩 배지
- 이미지 배지
- 연결도 배지 (작업 중인 팀만)
- 미연결 버튼 배지 (1 이상일 때)

카드 본문:
- 장면 수 / 일반 / 엔딩 / 첫 감상 장면
- 한 줄 해석
- 문제 진단 목록 (시작점 / 다시 시작점 / 엔딩 없음 / 연결도 / 미연결 버튼 / 고립 장면 / 내용 없는 장면)

상세 (펼침):
- 문제 진단 + 장면 목록 칩

필터 / 정렬:
- 상태 필터 (5종)
- 모드 필터 (6종)
- 정렬 (이름순 / 장면 수 / 문제 우선)

---

## 8. 의도적으로 보류한 기능

다음 항목은 마감 안정화 단계에서 **의도적으로 구현하지 않았음**.

- 학생 계정 생성
- 학생 비밀번호 변경 / 초기화
- 학생 무한 팀 생성 제한
- 최근 수정 시간 표시
- 실제 삭제 권한 부여 (현재는 `PERMISSION_DENIED`로 차단)
- Firebase Rules 변경 (`database.rules.json`)
- Firebase Auth 구조 변경
- 일괄 초기화 / 일괄 삭제

이 기능들은 단순 버튼 추가로 처리해서는 안 되는 영역.

---

## 9. 보류 이유

### 학생 계정 / 비밀번호 관련

- 현재 학생은 **익명 Auth + 팀명** 기반 구조
- 학생 계정 자체가 없으므로 "계정 생성 / 삭제"는 개념상 성립하지 않음
- 학생 비밀번호 개념도 없음 (익명 토큰이라 변경 / 초기화 대상이 없음)
- 학생 계정 기능을 추가하려면:
  - Firebase Auth Email/Password로 모델 전환
  - `students/{uid}` 같은 새 데이터 노드
  - `database.rules.json` 변경
  - `viewer-entry.js` / `teacher-auth.html` / `maker.html` 진입 흐름 전체 변경
- 위 변경은 **사용자 명시 보호 영역** 다수를 건드림 → 마감 직전 회귀 위험 매우 큼

### 최근 수정 시간 표시 관련

- 저장 흐름(`viewer-data.js`의 `_queueSave` / `saveSceneText`)에 timestamp 필드 추가가 필요함
- `viewer-data.js`는 사용자 명시 절대 보호 영역
- 마감 후 별도 Phase에서 설계 / 운영 정책 합의 후 진행 권장

### 실제 삭제 권한 관련

- 현재 Firebase Rules에서 admin 화면의 직접 삭제를 막고 있음 (의도된 보안 정책)
- 관리모드는 이를 친화 메시지로 안내하는 수준에서 끝
- 실제 삭제 권한을 열려면 `database.rules.json` 변경 + 운영 정책 합의 필요

### 일괄 초기화 / 일괄 삭제 관련

- 학생 작품 영향 범위가 매우 커서 의도적으로 만들지 않음
- 마감 후에도 추가하지 않는 쪽이 안전

---

## 10. 다음 후보

마감 안정화 단계에서 검토할 수 있는 후보 (모두 사용자 합의 후 진행).

- 관리모드 화면에서 문제 우선 정렬 실제 눈검수
- 관리모드 시각 디자인 미세 조정 (배지 색 / 줄바꿈 / spacing)
- 최근 수정 시간 **설계만** 별도 검토 (구현은 아직)
- 학생 계정 모델은 마감 후 별도 Phase로 설계
- 테스트용 삭제 / 복구 플로우는 별도 테스트 클래스 / 팀 마련 이후 검토
- 그림책 마감 체크리스트 1회 시연 (자동 스크린샷 + 수동 입력 / 저장 / F5)

---

## 11. 작업 원칙

다음 작업자 / 새 GPT / Claude가 관리모드를 이어갈 때 지킬 기준.

- 관리모드 개선은 **`adminConsole.js` 중심**으로 최소 변경
- Firebase 쓰기 / 삭제 기능은 매우 조심 (확인 단계 / 권한 검증 / 친화 메시지 필수)
- 학생 계정 / 비밀번호 기능은 단순 버튼 추가로 처리하지 않음 — 모델 설계부터
- 저장 구조 / `maker.html` / `viewer-data.js` / `database.rules.json` / `functions/`는 보호 영역
- 새 기능 추가보다 기존 기능의 안전성 / 가독성 보강 우선
- 모든 변경은 `node scripts/precommit-check.js` 통과 + specific add + 단일 commit

---

**문서 작성 시점**: 2026-05-29
**기준 commit**: `417951d Improve admin issue sorting`
