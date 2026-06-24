# 생각 나침반 Phase 0 — 배포 전 계획 (foundation)

> ⚠ 실제 배포·운영 write 없음. Phase 0은 **foundation(순수 로직·plan·controller)만** 구현. 실제 7문항 UI·AI 호출·editSession·기본 장면 자동 생성은 Phase 1.

## 1. 구현 commit 목록
| commit | Phase | 내용 |
|--------|-------|------|
| `4b3ebfb` | B | thought compass 상태 foundation(`thought-compass.js`) + 테스트 |
| `4b8d598` | C | 저장 plan·adapter(`thought-compass-store.js`) + Rules 테스트(writingGuide/onboarding) |
| `e7ae1ec` | D | 진입 게이트 결정·shell(`thought-compass-gate.js`) |
| `3bbc508` | E | 중단·이어하기(resolveResumePoint) |
| `01c030b` | F | 완료 판정·story seed |
| `e7c4496` | G | 기존 프로젝트 선택 진입 버튼 controller |
| `483ff61` | H | 수명주기(PRE-01~04) 정합 |

## 2. 변경 데이터 경로 (신규, migration 없음)
- 읽기/쓰기(어댑터 — **현재 휴면, 미연결**): `classes/{classId}/teams/{enc}/writingGuide/preWriting`, `/onboarding/version`, `/editSession`(read).
- preWriting 필드: `version, status(notStarted|inProgress|completed), currentQuestionIndex, answers, followUps, startedAt, updatedAt, completedAt`.
- **viewer-meta/onboardingVersion 미사용**(공개 노드 노출 회피, SEC-PRE-04b). 신규 판정 = `onboarding/version` 또는 `viewer-meta.copiedFrom`(복사본).
- **운영 데이터 migration 0** — 기존 작품·scenes·viewer-meta 변형 없음.

## 3. migration 없음
- 기존 작품: onboarding/version 없음 → optional(제작 차단 없음). 강제는 신규/복사본만.

## 4. 신규·기존 프로젝트 동작
- **신규 그림책·텍스트**(onboarding/version≥1) → `thoughtCompassRequired`(게이트, 닫기·건너뛰기 없음).
- **복사본**(viewer-meta.copiedFrom + 그림책/텍스트) → required(PRE-02). copy 시점 onboarding write는 비member라 Rules가 막으므로 **copiedFrom 마커로 판정**(라이브 코드·Rules 무변경).
- **신규/기존 movie·experience** → none(미적용, 기존 진입).
- **기존 그림책·텍스트** → optional. 시작 전 "나중에" 가능, **시작(in_progress) 후엔 완료 전까지 일반 편집 차단**.
- **completed** → editableMaker(통과).

## 5. 복사·초기화 정책 (PRE-01~04)
- **PRE-01 clearAll**: 현행 `clearAll`(ui.js:497)은 **scenes만** 초기화 → writingGuide/onboarding/editSession **유지**(코드 변경 불필요). compass plan은 scenes 경로를 절대 쓰지 않음(테스트 보장).
- **PRE-02 복사**: writingGuide 미승계 + copiedFrom으로 required. (장기적으로 onboarding/version write가 필요하면 첫 로그인 후 member 권한으로 부여 — Rules 변경 불요한 대안.)
- **PRE-03 교사 초기화**: `planResetCompassOnly`(기본=나침반만) / `planResetFullOnboarding`(전체) — admin 액션 wiring은 Phase 1.
- **PRE-04 계정 삭제**: compass 데이터는 개인 식별자 미보존(`sanitizeThoughtCompassState`가 uid/PII 제거) → 익명화 사실상 no-op. 공유 콘텐츠 유지.
- **삭제**: 프로젝트(팀) 삭제는 팀 root remove(adminConsole `_deleteTeam`)로 writingGuide/onboarding 함께 삭제(cascade 유지).

## 6. 롤백
- Phase 0 산출물은 **휴면 신규 파일(thought-compass*.js) + 테스트**라 라이브 동작에 영향 0 → 롤백 위험 낮음. 필요 시 해당 commit revert(라이브 maker/login/viewer 무영향).
- **보안 Rules·Functions·로그인은 이 Phase에서 무변경** — 팀 read 보안(별도 완료분)과 독립.

## 7. 수동 QA (활성화 시점에)
foundation은 자동 테스트 완료. **활성화(라이브 게이트 연결) 후** 실기기 QA: 신규 그림책/텍스트 게이트 노출·닫기 불가 / movie 미차단 / 기존 작품 정상 / 시작 후 새로고침 이어서 / 복사본 게이트 / 완료 후 maker 진입.

## 8. 배포 순서 (활성화는 Phase 1)
- **현재 상태**: thought-compass*.js가 main(GitHub Pages)에 push됨 = 파일은 라이브이나 **어떤 HTML도 `<script>`로 로드하지 않음 → 비활성(inert)**. 운영 영향 0.
- **활성화(후속)**: ① maker.html에 `thought-compass.js`·`thought-compass-store.js`·`thought-compass-gate.js` `<script>` 추가(+캐시 토큰) ② maker 진입(`_enterMakerAfterPtypeSelected`/`_enterTeam`) 직후 **단일 훅**으로 `ThoughtCompassGate.maybeBlock(ctx, {onStart,onResume})` 호출 ③ 브라우저 QA ④ Pages 단일 push. **Rules/Functions 추가 배포 불요**(writingGuide/onboarding Rules는 이미 운영 배포됨).

## 9. 중단 기준
- 활성화 wiring이 라이브 maker 진입/로그인 회귀 / 기존 작품 자동 진입 정책 충돌 / clearAll·copy 동작이 문서와 다름 / 기본 장면 생성이 기존 scenes 훼손 / Rules 추가 변경 필요 / PB-MOOD 변화 → 즉시 중단.

## 10. Phase 1 남은 범위 (이번 미구현)
7개 실제 질문 콘텐츠 · 한 화면 한 질문 UI · 보기 3개+직접 적기 · 모르겠어요 완화 · AI NEXT/ASK_FOLLOW_UP/ASK_EASIER 호출 · 최대 5후속/12문항 · 최종 검토 화면 · 답변 수정 drawer · 브랜치 재열람 · editSession heartbeat·3분 takeover·이전 편집자 read-only · 기본 장면 10개 실제 자동 생성 · **게이트 라이브 활성화 wiring + 브라우저 QA**.

## 11. 현재 자동 검증 상태
thought-compass 75/75 · Rules 34/34(×3) · membership-login 20/20 · 정적·precommit 통과 · Functions 회귀 0 · PB-MOOD 불변. **판정: AUTOMATED_COMPLETE / MANUAL_UI_QA_REQUIRED**(활성화 wiring + 실기기 QA 후 라이브).
