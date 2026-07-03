# ADMIN-STUDENT-ACCOUNT-1-AUDIT — 관리모드·학생 계정/로그인/PIN/삭제 전수조사

- 일자: 2026-07-03 · 기준: origin/main `cfbf4f1` · read-only(코드 0·DB write 0·계정 생성/삭제 0·deploy 0·AI 0)
- 배포 rules = repo 동일(drift 0 실확인)
- 판정: **ADMIN_STUDENT_ACCOUNT_READY_FOR_DESIGN** — 사용자가 원하는 "교사 생성형"의 골격
  (teacher_managed 모드·account·PIN 변경·잠금)이 **이미 구현돼 있음**. 설계 확정+완성이 다음 단계.

## 1. 현재 로그인/입장 흐름 (요약)
- index.html: 학생(팀)→maker.html / 감상자→viewer.html / 교사→teacher-auth.html — 역할 분기 존재.
- 학생 입장 = **익명 Firebase Auth + 클래스 코드(선택) + 팀 이름 + PIN(4~6자리)** →
  서버 callable `joinTeamMembership`(functions/index.js:2761-2891)이 PIN 검증 후
  `members/{uid}{status:'active',...}` 발급(개인정보 0·rate limit 1분 5회·PIN 원문 비노출).
- 세션: sessionStorage makerSession(PIN 미저장)·F5 복원은 members status 재검증·로그아웃 없음
  (모둠 바꾸기=세션 초기화)·익명 uid는 IndexedDB 지속.
- **학생 개인 계정(이메일/비번)은 없음** — 전부 팀(모둠) 단위. 교사만 이메일/Google 계정
  (custom claim role=teacher/super_admin·super_admin은 콘솔에서만 부여).

## 2. 데이터 관계표 — 계정/프로필/멤버십/작품
| 축 | 실체 | 위치 | 삭제 시 영향 |
|---|---|---|---|
| 계정 | **팀 단위** ①account(교사 생성: displayName/pin/status/createdBy) ②legacy pin(첫 학생 자동 설정) | teams/{enc}/account · /pin | account만 지우면 팀 데이터 무손실(입장만 막힘) |
| 프로필 | **없음**(개인 이름/연락처 저장 0) | — | — |
| 멤버십 | members/{uid}(기기별 익명 uid·서버 발급·write:false) | teams/{enc}/members | 지워져도 재로그인(PIN)으로 재발급 가능 |
| 작품 | scenes/viewer-meta/aiVariants/aiChecks/locks… | teams/{enc}/* | **팀 삭제=전부 소멸**(복구 불가) |
→ 계정·멤버십·작품이 같은 팀 노드 아래에 있어 "팀 삭제"가 셋을 한 번에 지움. 분리 UI 없음(§6).

## 3. 관리모드 현황 (adminConsole.js — 이미 있는 것이 많다)
| 기능 | 상태 | 방식 |
|---|---|---|
| 팀(계정) 사전 생성+PIN 발급 | ✅ ADMIN-1B | client write(account) — rules 교사 전용 |
| 팀 생성 모드 설정(legacy_open/teacher_managed/locked) | ✅ ADMIN-1C | settings/teamCreationMode |
| PIN 변경 | ✅ ADMIN-1D(등록팀만) | prompt 입력→account/pin update·자동 생성/전달 지원 없음 |
| 팀 잠금/해제 | ✅ ADMIN-1D | account/status |
| 기존 팀 관리팀 등록 | ✅ ADMIN-1E | account 부여(백필 도구) |
| 팀 삭제 | ✅(confirm+팀명 재입력 이중 확인) | client remove — **v2 rules상 교사/super만 허용**($team write=`!newData.exists()`=삭제 전용). 잔여: classCodes 유지·copyCodes(24h TTL)·**Storage 이미지 고아** |
| 공개 토글·복사 코드·감상/수정/인쇄 진입 | ✅ | — |
| **학생(기기) 멤버 목록 UI** | ❌ 없음 | rules는 교사 read 허용 — UI만 부재 |

## 4. 권한/보안 구조
- 잘 되어 있는 것: members write:false(서버 발급)·account/pin 교사 전용·aiChecks(이번 추가)·
  admin 진입 teacher-auth·삭제 이중 확인·rate limit.
- **Critical(알려진 순차 계획)**: `scenes`/`viewer-meta` **write = auth!=null(익명 전원)** —
  rules 차원에선 다른 학급 학생도 남의 팀 작품 수정 가능. tests/rules README의 SEC 메모대로
  "membership 정본화 후 write 강화 원자 배포"가 계획돼 있으며 아직 미실행. 계정 트랙과 별도
  SEC 트랙으로 관리(막 조이면 legacy 팀 maker 쓰기 회귀).
- **High**: legacy_open이 사실상 기본(설정 없으면 폴백) → **학생이 새 팀명 입력만으로 팀 무한
  생성 가능**(분당 5회 제한뿐). teacher_managed로 바꾸는 스위치는 이미 있으나 기본값·온보딩 문제.
- legacy membership 미기록의 실체: 2h 세션 만료·기기 변경으로 **새 익명 uid**가 되면 members에
  없음 → PIN으로 재입장하면 joinTeamMembership이 **재발급 = 자연 백필**. 문제는 (a)PIN을 모르는
  경우(교사가 PIN 변경으로 해결 가능) (b)발급 실패 후 안내 UX. 별도 migration 불필요 판단.

## 5. 설계안 비교
- **B안(추천 ★): 교사 생성형 완성** — 이미 있는 teacher_managed+account를 기본 경험으로:
  신규 클래스 기본값을 teacher_managed로(또는 온보딩에서 선택 강제), PIN 자동 생성+
  **학생 전달용 카드 인쇄**, 멤버(기기) 목록 UI, 재입장 실패 안내 정리.
  수정 범위: adminConsole/firebase.js client-only 위주 · Functions 불필요(joinTeamMembership 재사용) ·
  Rules 불필요 · migration 불필요. 학생 UX 변화 없음(입장 방식 동일).
- A안(현상 유지+최소 보강): 무한 생성 미해결 — 비추천.
- C안(승인제): 승인 대기 상태·실시간 갱신 등 신규 상태 기계 필요 — 초등 수업 흐름에 과함.
- D안(팀 비밀번호만): 현 legacy_open과 동일 — 사용자가 피하려는 방향.

## 6. 위험도
- **Critical**: scenes write auth!=null(§4·별도 SEC 트랙) / 팀 삭제=작품+계정+멤버십 동시 소멸
  (이중 확인은 있으나 "계정만 삭제/잠금"과 분리 안 됨).
- **High**: legacy_open 기본 → 무한 팀 생성 / PIN 전달·재발급 UX 부재(자동 생성·인쇄 없음).
- **Medium**: 멤버 목록 UI 부재(교사가 팀 구성 파악 불가) / 팀 삭제 후 Storage 고아·classCodes 잔존 /
  '팀 삭제' 용어가 계정 삭제와 미구분.
- **Low**: 입장 화면 역할 안내 문구·admin 카드 밀도.

## 7. 추천 로드맵 (전부 사용자 승인 후 단계별)
1. **ACCOUNT-2-DESIGN**: B안 확정 + 기본 모드 정책 결정(신규 클래스 teacher_managed 기본?
   기존 클래스는 교사 선택 유지). 문서만.
2. **ACCOUNT-3-MEMBERSHIP-UX**: 재입장/발급 실패 안내 정리 + "PIN으로 다시 들어오면 자동 복구"
   흐름 명시(legacy 백필 = 재로그인 유도. migration 0). client-only·낮음. ← H-1 트랙 흡수
3. **ACCOUNT-4-PIN-KIT**: PIN 자동 생성 버튼 + 팀별 "입장 카드"(클래스 코드/팀/PIN) 인쇄
   (기존 print gate 패턴 재사용). client-only·낮음.
4. **ACCOUNT-5-MEMBER-LIST**: admin 팀 상세에 멤버(기기) 목록·상태 표시(rules 이미 허용).
   client-only·낮음.
5. **ACCOUNT-6-DELETE-SAFETY**: '입장 잠금'(이미 있음) ↔ '계정만 삭제(account 제거)' ↔
   '팀 전체 삭제' 3단 분리 UI + 삭제 후 잔여물 안내. client-only·중간.
   (Storage 고아 정리는 Functions 필요 — 별도 후속으로 표기만)
6. **ACCOUNT-7-LOGIN-UX**: 학생 입장 화면 문구/역할 구분 다듬기. client-only·낮음.
7. **(별도) SEC-WRITE-HARDENING**: scenes/viewer-meta write를 member 기반으로 강화 —
   3~5 완료(membership 정본화) 후 Rules 원자 배포. Rules deploy·**높음·별도 승인**.

## 8. 다음 구현 명령 제안
`ADMIN-STUDENT-ACCOUNT-2-DESIGN`(정책 2~3개 결정 포함) → 이후 3·4·5는 한 루프씩 client-only로
빠르게 진행 가능. SEC-WRITE-HARDENING은 마지막에 별도 승인으로.
