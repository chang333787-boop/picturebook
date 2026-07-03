# ACCOUNT-MODE-DEFAULT-1 — 신규 학급 teacher_managed 기본값 + 기존 학급 전환 안내

- 일자: 2026-07-03 · 기준: origin/main `6a3541c` · client-only
- 판정: **ACCOUNT_MODE_DEFAULT_1_LIVE_PASS**

## 구현
### ① 신규 학급 = teacher_managed 명시 기록 (teacher-auth.html)
학급 만들기 성공 흐름(2단계 write)의 **2단계 원자 update에 settings 필드 추가**:
```
db.ref().update({
  classCodes/{code}: classId,
  teacherClasses/{uid}: classId,
  classes/{classId}/settings/teamCreationMode: 'teacher_managed',   // ← 추가
})
```
- 1단계에서 `classes/{id}/meta`(teacher_uid)가 이미 커밋되므로 settings write 룰
  (`root.meta/teacher_uid === uid`) 통과. `.validate('teacher_managed')` 통과.
- 원자 update라 검증 실패 시 학급 생성 **전체 롤백**(부분 생성 없음).
- **전역 fallback(legacy_open)은 불변** — functions/index.js·firebase.js 미변경. 이 값은
  신규 학급에만 명시 기록되고, 기존 학급/미설정 학급은 그대로 legacy_open으로 동작.
- **기존 학급 일괄 전환·자동 전환 없음.**

### ② 관리모드 상태 배지 (adminConsole.js `_renderTeamModePanel`)
현재 모드에 따라 방식 패널 상단에 배지 표시(기존 전환 스위치는 유지·문구 보강):
- teacher_managed → 🔒 "교사 등록 모둠만 입장 — 선생님이 만든 모둠만 들어올 수 있어요." (녹색)
- legacy_open(및 미설정 폴백) → 🚪 "자유 입장 상태 — 지금은 학생이 새 모둠을 직접 만들 수
  있어요. 아래에서 교사 등록 모둠만 입장으로 바꾸면 오타·장난 모둠 생성을 막을 수 있어요." (호박색)
- CSS: maker.html `.admin-tm-badge{--managed/--open}`.

## 검증
- **Rules 에뮬레이터 79/79 PASS**(기존 70 + 신규 team-creation-mode 9): 담당 교사/super_admin의
  teamCreationMode write 허용, 학생·타학급 교사·미인증 거부, 화이트리스트 외 값·숫자 거부,
  settings read 공개(입장 폼 모드 판별). → 신규 학급 생성 write 경로가 rules상 허용됨을 증명.
- **배지 렌더 하니스**(실 adminConsole.js·Playwright): teacher_managed=녹색 배지·legacy_open=
  호박색 배지·미설정(null)=legacy 폴백 배지·라디오 동기화·console error 0.
- node 스위트 462/462 · functions/rules diff 0 · node --check adminConsole.js OK.
- ⚠️ 실제 학급 생성 end-to-end는 운영 DB write·계정 필요라 이번 범위 금지 — write **권한**은
  에뮬레이터로, 배지 **표시**는 하니스로 분리 검증. 실계정 생성 1회는 사용자 확인 항목.

## 안전/원본 보존
- 코드 수정: teacher-auth.html·adminConsole.js·maker.html(CSS+버스터) + rules 테스트/문서.
- 운영 DB write 0(에뮬레이터·하니스 mock만) · 실제 계정 생성/삭제 0 · Functions/Rules deploy 0 ·
  전역 fallback 불변 · 기존 학급 무영향.
- 버스터: maker.html의 adminConsole.js `?v=` += `accountmode1`. (teacher-auth.html은 인라인 스크립트라 HTML 갱신으로 반영.)

## 남은 후속 (설계 로드맵)
TEAM-ACCOUNT-CARD-1(PIN 자동+입장 카드) → UX-1 → MEMBER-LIST-1 → LEGACY-UX-1 →
DELETE-SAFETY-2 → (별도 승인)SCENES-WRITE-HARDEN-1.
사용자 확인: 새 학급 1개 만들어 관리모드에서 "교사 등록 모둠만 입장" 배지 뜨는지.
