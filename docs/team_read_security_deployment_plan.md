# 팀 데이터 읽기 보안 — 원자 배포 계획 (실행 전 문서)

> ⚠ **실제 배포 금지(사용자 승인 전).** 이 문서는 배포 순서·rollback·수동 QA만 정리한다.
> 핵심 위험: **client(GitHub Pages)와 Firebase(Functions+Rules)는 배포 메커니즘이 다르다.**

## 0. 배포 메커니즘 (반드시 먼저 이해)
- **client(maker.html·firebase.js·membership-login.js·ui.js 등) = GitHub Pages.** `firebase.json`에 **hosting 타깃 없음**, `.github/workflows`·`gh-pages` 브랜치 없음 → GitHub Pages가 **main 브랜치를 직접 서빙**할 가능성이 높음(저장소 Pages 설정 확인 필요). 이 경우 **main push = client 라이브 배포**.
- **Firebase = Functions(joinTeamMembership) + Database Rules + Storage Rules.** `firebase deploy --only ...`로 **수동** 배포(아직 미배포).
- ⚠ **현재 상태**: SEC-4·5 client 변경이 main에 push됨 → **Pages가 라이브면 새 client는 이미 배포됨**. 그러나 `joinTeamMembership` Functions·SEC-2 Rules는 **미배포**.
  - **→ 결과**: Pages가 라이브라면 **지금 학생 로그인이 깨진 상태**일 수 있음(새 client가 없는 callable 호출). **최우선 조치 = Functions 즉시 배포** 또는 client commit 일시 revert. (Pages 비활성/별도 소스면 무관 — 배포 전 Pages 설정 확인 필수.)

## 1. 변경 commit 목록
| commit | 내용 | 배포 대상 |
|--------|------|------|
| `30b8a66` | 결정 문서 | (문서) |
| `84f8c3d` | tests/rules 인프라 | (테스트, 미배포) |
| `b973f73` | Rules 회귀 baseline | (테스트) |
| `ff380af` | **자식별 read Rules + isPublic 강제** | **Database Rules** |
| `967ad5a` | **joinTeamMembership CF**(3모드+rate-limit transaction) | **Functions** |
| `7a71a22` | **학생 로그인 callable 정본화**(membership-login.js, firebase.js, maker.html SDK) | **client(Pages)** |
| `e20d4c5` | **sessionStorage PIN 제거 + membership 복원**(firebase.js, ui.js) | **client(Pages)** |

## 2. 변경 데이터 경로 (migration 없음)
- 신규: `classes/{classId}/teams/{enc}/members/{uid}`(CF Admin SDK write), `membership-attempts/{uid}`(CF rate-limit, read/write false).
- Rules 변경: `classes/{classId}/teams` 상위 read 해체 + 자식별(scenes/viewer-meta=isPublic||member||교사, pin/account=교사만, members 본인/교사, editSession/writingGuide/onboarding member/교사), v1 `teams/pin` read 닫음.
- **운영 데이터 migration 없음**: 기존 teams/pin·account/pin 구조 유지(CF가 통합 검증). 기존 작품 데이터 변형 0.

## 3. migration 없음
- 기존 팀 노드 구조 그대로. members는 학생이 새로 로그인할 때 CF가 발급(점진). 기존 사용자는 1회 재인증으로 members 생성.

## 4. 배포 전 확인
- `cd tests/rules && npm test` → **22/22**(3회 연속 동일). (Java 21+ 필요: `JAVA_HOME=~/.local/jdk/jdk-21.0.11+10-jre/Contents/Home`.)
- `node --test tests/membership-login/membership-login.test.js` → **20/20**.
- `node --check firebase.js membership-login.js functions/index.js` · `python3 -m json.tool database.rules.json firebase.json` · `node scripts/precommit-check.js`.
- **GitHub Pages 설정 확인**(Settings→Pages: source 브랜치/폴더). main 라이브 여부 확정.
- §10 수동 브라우저 QA.

## 5. 원자 배포 순서
client(Pages)와 Firebase는 동시 원자 배포가 **불가**(다른 시스템). 안전 순서:
1. **Functions 먼저**: `firebase deploy --only functions:joinTeamMembership`. (callable이 있어야 새 client 로그인 동작. Pages가 이미 라이브면 이게 **로그인 복구**.)
2. **callable smoke**(§6) — 테스트 학급에서 로그인 1회 성공 확인.
3. **Database Rules**: `firebase deploy --only database`. (PIN 공개 read 차단. 새 client는 pin 직접 read 안 하므로 무영향. CF는 Admin SDK라 Rules 무관.)
4. **client(Pages)**: main이 이미 라이브면 추가 작업 없음. Pages가 수동/별도면 이 시점에 publish.
- **호환성 매트릭스**(왜 이 순서가 안전한가):
  - 새 client + **구 Rules(공개)** + **신 Functions**: 로그인 OK(CF), PIN은 잠깐 공개 상태(구 Rules) — 무중단. → 그 후 Rules 닫음.
  - 새 client + **신 Rules** + **신 Functions**: 완전 보안. 새 client는 pin 직접 read 0이라 정상.
  - **금지**: Rules를 client/Functions보다 먼저 단독 배포 → 구 client(캐시) pin read 차단 → 로그인 실패.
- **노출 구간 명시**: 1)~3) 사이 = PIN 공개(구 Rules) 유지되는 준비 구간(수 분). 3) 이후 차단.

## 6. smoke test (배포 후 즉시)
- 테스트 학급(운영 학생 영향 0)에서: legacy_open 로그인 성공 / 잘못된 PIN 거부 / locked 거부 / 새로고침 복원 / 공개 viewer 로드 / 비공개 URL 차단.
- callable 직접: `joinTeamMembership({classId, teamName, pin})` → `{ok:true}`(정상), 잘못된 PIN → permission-denied.

## 7. rollback (우선순위)
1. **client 우선**: Pages를 직전 커밋으로 되돌림(`git revert 7a71a22 e20d4c5` 또는 Pages 이전 빌드). 구 client는 구 Rules(공개)와 동작 → 로그인 복구.
2. **Functions 유지**: joinTeamMembership는 두어도 무해(구 client는 호출 안 함).
3. **Rules rollback = 최후 수단**.
- ⚠ **경고**: 이전 Rules(`ff380af` 이전)로 되돌리면 **PIN·비공개 작품 공개 read 취약점이 재발**. 로그인 장애 대응의 **첫 수단으로 Rules 전체 공개 복구를 쓰지 말 것**.
- 로그인 장애 시 대안: 점검 화면 · 교사 긴급 안내 · callable 장애 수정 · client 이전 버전 복구(PIN 입력 화면 차단 후).

## 8. PIN 공개 재발 경고
- Rules를 `ff380af` 이전으로 rollback하면 `teams/.read:true` cascade가 되살아나 **pin·account.pin·members·비공개 scenes가 다시 공개 read**된다. Rules rollback은 보안 후퇴이며, 반드시 client/Functions 우선 대응 후에만 최후로 고려.

## 9. 기존 사용자 1회 재인증 안내
- members가 없는 기존 사용자는 자동 복원이 안 되어 **PIN 1회 재입력**이 필요. 안내 문구:
  > 안전한 접속 확인을 위해 모둠 비밀번호를 한 번만 다시 입력해 주세요.
- 재입력 1회로 CF가 membership 발급 → 이후 자동 복원.

## 10. 수동 브라우저 QA 체크리스트 (배포 승인 전, 실기기/폰 시뮬)
1. 신규 legacy_open 학생 로그인 ✅ 2. teacher_managed 학생 로그인 ✅ 3. 잘못된 PIN → 통합 오류·진입 0 4. locked 팀 → 거부 5. 새로고침 자동 복원(membership active) 6. 기존 사용자 1회 재인증 7. 공개 그림책 viewer 8. 공개 텍스트 viewer 9. 비공개 작품 직접 URL 차단 10. 교사 PIN 조회·변경(관리모드) 11. 관리모드 팀 목록 12. 모바일/PWA 로그인. (+ Functions SDK namespace 로드·console error 0·중복 클릭 1회.)

## 11. 배포 후 모니터링
- Functions 로그(`firebase functions:log`): joinTeamMembership 오류율·rate-limit(resource-exhausted) 빈도. **PIN이 로그에 없는지** 확인.
- 로그인 실패율(학생 문의), members 발급 추이, membership-attempts 이상 급증.
- Rules 거부 급증(공개 viewer 깨짐 신호) 모니터.

## 12. 중단 기준 (배포 롤포워드 중단)
- callable smoke 실패 / 공개 viewer 회귀 / 교사 관리 회귀 / 로그인 실패율 급증 / PIN 로그 노출 발견 / Rules가 정상 사용자 차단. → 즉시 §7 rollback(client 우선).

---
**현재 자동 검증 상태**: Rules 22/22(×3), 로그인 하니스 20/20, 정적 통과, Functions export 회귀 0, PB-MOOD 불변. **판정: READY_FOR_MANUAL_QA**(수동 브라우저 QA + Pages 설정 확인 후 배포 승인). 실제 배포는 사용자 승인 전 금지.
