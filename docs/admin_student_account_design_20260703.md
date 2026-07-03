# ADMIN-STUDENT-ACCOUNT-2-DESIGN — 교사 생성형 모둠 계정 정책 확정 설계

- 일자: 2026-07-03 · 기준: origin/main `0f6ca3b` · read-only 설계(코드 0·DB 0·deploy 0·계정 0)
- 선행: docs/admin_student_account_audit_20260703.md
- 판정: **ADMIN_STUDENT_ACCOUNT_DESIGN_READY** — 정책 확정. 아래 8개 결정을 이 문서로 고정.

## 0. 용어 확정 (개인정보 부담 낮춤)
개인 학생 계정/프로필은 존재하지 않는다(익명 uid + 팀 PIN). 따라서 UI 표현은 **"모둠 계정"**으로
통일한다. 단, 교사 안내에는 "학생들이 쓰는 모둠 로그인"이라고 1줄 부연(교사 멘탈모델 = 학생용).

## 1. 핵심 제약 (설계의 뼈대)
- **기본 폴백 `legacy_open`은 절대 전역 변경 금지.** functions/index.js:2830·firebase.js는 미설정 시
  legacy_open으로 폴백 — 이걸 teacher_managed로 바꾸면 **모드를 한 번도 설정 안 한 기존 학급 전원이
  즉시 입장 불가**(등록 팀 0). → 기본값 전환은 **학급 생성 시점에 명시 write**로만(§2).
- 모드/PIN/locked 검증은 서버 `joinTeamMembership`가 정본(client 우회 불가). UI는 경험만 담당.

## 2. 결정 ① 신규 학급 기본 모드 / ② 기존 legacy_open 처리 — **A+C 하이브리드 (추천)**
- **① 신규 학급 = teacher_managed 명시 기록.** teacher-auth.html의 "클래스 만들기" 성공 시
  `settings/teamCreationMode = 'teacher_managed'`를 함께 write. (폴백은 그대로 legacy_open 유지 —
  기존 학급 무영향.) 오타·장난 팀 무한 생성이 신규 학급부터 원천 차단.
- **② 기존 legacy_open 학급 = 유지 + 전환 넛지.** 강제 전환(B안)은 기존 학급 입장 실패 위험 →
  비채택. 대신 admin에 "교사 등록 팀만 입장하게 바꾸기" 안내 배지(등록 팀이 이미 있을 때만 권장 표시).
- 정책안 비교:
  | 안 | 무한생성 해결 | 기존학급 위험 | 범위 | migration | 추천 |
  |---|---|---|---|---|---|
  | A 신규만 기본 전환 | 신규만 | 없음 | client(class 생성 1곳) | 0 | 부분 |
  | B 전원 강제 | 즉시 | **높음(입장 불가)** | client | 0 | ✗ |
  | C 기존 전환 안내 | 교사 선택 | 없음 | client(admin 배지) | 0 | 부분 |
  | D 문구만 완화 | 미해결 | 없음 | client | 0 | ✗ |
  → **A(신규 기본) + C(기존 넛지) 채택.** 둘 다 client-only·Rules/Functions/migration 불필요.

## 3. 결정 ③ 학생 입장 UX
- teacher_managed 모드: 폼은 동일(클래스 코드→팀 이름→PIN)이나 **"새로 만든다" 느낌 제거**.
  버튼 `입장하기`, 안내 "선생님이 알려준 모둠 이름과 비밀번호를 입력하세요."
- **오류 문구 개선(보안 유지)**: 현재는 단일 generic("…다시 확인해 주세요") — teacher_managed
  미등록 팀도 같은 문구라 학생이 막막함. 존재 비노출은 지키되 **"…다시 확인하고, 안 되면 선생님께
  물어보세요."**로 교실 맥락 추가(팀 존재 여부는 여전히 미노출). 잠금은 기존 "지금은 선생님이
  입장을 잠시 닫아 두었어요." 유지.
- legacy_open 모드: 자동 생성이 실제로 가능하므로 안내를 과하게 숨기지 않음(오해 방지). 단 신규
  학급은 §2로 teacher_managed라 이 경로 자체가 줄어듦.
- 모드는 클래스 코드 확인 후 알 수 있음(_readTeamCreationMode) → 코드 입력 후 폼 문구를 모드별로
  바꾸는 건 TEAM-ACCOUNT-UX-1에서. client-only.

## 4. 결정 ④ 교사 관리 UX — "모둠 계정 관리" 정리
이미 있는 것(ADMIN-1B~1E: 계정 생성·PIN 변경·잠금·등록)을 한 섹션으로 묶고 부족분만 추가.
- 기존: 모둠 계정 만들기 · PIN 변경 · 입장 잠금/해제 · 기존 팀 관리팀 등록 · 생성 방식 설정.
- 추가(후속 트랙):
  - **PIN 자동 생성 버튼**(4자리 숫자·중복 회피) — 지금은 교사 수동 입력만.
  - **입장 카드 인쇄**(클래스 코드/모둠/PIN을 팀별 카드·명단으로) — 기존 print gate 패턴 재사용.
  - **멤버(기기) 목록**(members/{uid} — rules 이미 교사 read 허용, UI만 부재).

## 5. 결정 ⑤ PIN 자동 생성 / 인쇄 / 초기화
- 자동 생성: 계정 생성·PIN 변경 모달에 "자동 만들기" 버튼(수동 입력도 유지).
- 인쇄: 모둠별 입장 카드(코드/모둠/PIN) — DB write 0·기존 인쇄 게이트 재사용. TEAM-ACCOUNT-CARD-1.
- 초기화 = 기존 PIN 변경(ADMIN-1D)과 동일 경로. 전달은 인쇄 카드로 흡수.

## 6. 결정 ⑥ 삭제 정책 — 위험도 3단 분리
현재 "팀 삭제"가 계정+멤버십+작품을 한 번에 지움(이중 확인은 있음). 3단으로 분리:
1. **입장 잠금**(이미 있음·account.status='locked') — 작품 보존·되돌리기 쉬움. 일상 도구.
2. **계정만 삭제**(신규·account 노드만 remove) — 입장 정보 제거·**작품 보존**. "이 모둠은 더 이상
   입장 못 하지만 작품은 남아요."
3. **모둠 전체 삭제**(이미 있음) — 작품까지 소멸·팀명 재입력 강확인 유지. "작품도 함께 영구
   삭제됩니다" 명시. 버튼 톤 위험색.
- 멤버십 초기화(기존 기기 입장 무효화)는 members write:false라 client 불가 → **Functions 필요**·
  후속 별도(TEAM-DELETE-SAFETY-2에 "서버 필요" 표기만).
- Storage 이미지 고아 정리도 Functions 필요 — 삭제 후 안내 문구로 우선 대응.

## 7. 결정 ⑦ legacy membership 처리 — 안내 우선, migration 불요
- 실체: 2h 세션 만료·기기 변경 → 새 익명 uid → members에 없음. **PIN 재입장하면 서버가 재발급
  = 자연 백필.** 별도 migration/backfill 스크립트 불필요.
- UX(LEGACY-MEMBERSHIP-UX-1): 결과 보기/저장 실패 시 "이 모둠은 입장 정보가 오래됐어요.
  모둠 비밀번호로 다시 들어오면 해결돼요." + 관리모드 팀 상태 배지. client-only.

## 8. 결정 ⑧ scenes write rules 강화 — 마지막·별도 승인
- Critical: scenes/viewer-meta write = `auth != null`(익명 전원) → 남의 팀 작품 수정 가능.
  기존 SEC 계획(rules README)대로 **membership 정본화 후** 원자 배포.
- **지금 하면 안 되는 이유**: legacy 팀 저장이 member-scoped write로 조이는 순간 깨짐(재입장 백필
  전). → 3·5·(멤버 정본화) 안착 후 SCENES-WRITE-RULES-HARDEN-1로 emulator+실저장 스모크+
  Rules deploy 별도 승인.

## 9. 추천 구현 순서 (전부 승인 후 단계별)
| # | 트랙 | client | Functions | Rules | DB write | 위험 | 테스트 포인트 |
|---|---|---|---|---|---|---|---|
| 1 | (완료) 2-DESIGN | — | — | — | — | — | — |
| 2 | ACCOUNT-MODE-DEFAULT-1 (신규 학급 teacher_managed 명시 + 기존 넛지) | ✅ | — | — | 학급 생성 시 settings write(교사) | 낮 | 신규=teacher_managed·기존 무영향·폴백 불변 |
| 3 | TEAM-ACCOUNT-CARD-1 (PIN 자동생성+입장카드 인쇄) | ✅ | — | — | account write(교사·기존 경로) | 낮 | 자동 PIN·카드 PDF·수동 입력 유지 |
| 4 | TEAM-ACCOUNT-UX-1 (학생 입장 문구/오류 모드별) | ✅ | — | — | 0 | 낮 | 모드별 문구·존재 비노출 유지 |
| 5 | ACCOUNT-MEMBER-LIST-1 (admin 멤버 목록) | ✅ | — | — | 0(read) | 낮 | 교사 read 허용·타학급 거부 |
| 6 | LEGACY-MEMBERSHIP-UX-1 (오래된 팀 재입장 안내) | ✅ | — | — | 0 | 낮 | 실패 지점 안내·재입장 백필 확인 |
| 7 | TEAM-DELETE-SAFETY-2 (잠금/계정삭제/전체삭제 3단) | ✅ | (멤버십 초기화·Storage 정리만 서버) | — | account remove(교사) | 중 | 계정만 삭제 시 작품 보존·강확인 |
| 8 | SCENES-WRITE-RULES-HARDEN-1 (별도 승인) | — | — | ✅ | — | 높 | emulator+실저장 스모크·legacy 회귀 |

## 10. 다음 구현 명령 제안
`ADMIN-STUDENT-ACCOUNT-MODE-DEFAULT-1` — 신규 학급 생성 시 teamCreationMode='teacher_managed'
명시 기록 + 기존 legacy_open 학급 admin 전환 넛지. client-only·저위험·폴백 불변.
(3~6은 이후 한 루프씩. 7은 중간, 8은 마지막 별도 승인.)
