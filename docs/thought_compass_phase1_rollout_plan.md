# 생각 나침반 Phase 1 — 병합 전 롤아웃 계획

> branch `feature/thought-compass-phase1`(기준 `db06e60`). **아직 main 미병합·Firebase 미배포·Pages 미활성.**
> 이 문서는 승인 후 배포 순서·위험·롤백·미완료 항목을 정리한다. 실제 배포는 사용자 승인 후.

## 1. 커밋 목록 (db06e60 이후 12개)
| commit | 내용 |
|--------|------|
| 4aa666f | Map thought compass phase one integration (Phase B 지도) |
| 6fb2d34 | Define thought compass core questions (Phase C) |
| 0f2dfd7 | Activate thought compass maker gate (Phase D) |
| 4c5e029 | Build thought compass question flow (Phase E) |
| 88da4c3 | Add easier thought compass answers (Phase F) |
| 72366c1 | Add thought compass follow-up callable (Phase G) |
| d3244cc | Connect adaptive thought compass questions (Phase H) |
| ec443fe | Add thought compass review screen (Phase I) |
| 159032c | Generate starter story structure from compass (Phase J) |
| 002225e | Add thought compass edit session control (Phase K) |
| 8b4fc78 | Add completed compass review entry (Phase L) |
| aab8e85 | Add thought compass phase one manual QA package (Phase N) |

신규 클라 모듈 11(thought-compass-*.js + .css), functions 2(followup 모듈·prompt), 테스트 8, 문서 3, 통합 수정 3(ui.js·firebase.js·maker.html).

### QA 루프 추가 커밋 (구현 12 + QA 5 = 총 17, HEAD `f86a8f3`)
| commit | 내용 |
|--------|------|
| e2794a6 | Verify thought compass security paths (rules editSession write 등 테스트 보강) |
| b067454 | Fix gate display, custom input, answer persistence (P1×3) |
| 0d17535 | Honor copiedFrom for copy-required gate (P1) |
| f86a8f3 | Fix edit session release not clearing session (P2) |

> Emulator E2E에서 P1 4건·P2 1건을 발견·수정. 상세는 `docs/thought_compass_phase1_qa_results.md`.

## 2. ⚠️ main Pages 자동 배포 위험 (가장 중요)
- GitHub Pages source = **main / (legacy)**. **main에 push/merge하는 즉시 운영(chang333787-boop.github.io/picturebook)에 반영**된다.
- 따라서 client 병합은 "준비 완료 + 승인" 후 한 번에. `.github/workflows` 없음 → feature branch는 배포 대상 아님(확인됨).
- 원본 repo에 PB-MOOD 미커밋 5파일이 있으므로, main 병합 작업 시 그 작업과 충돌/혼선 없도록 분리.

## 3. 배포 단위 & 순서
### (a) Functions — 신규 callable 1개
- 대상: `callThoughtCompassFollowUp` (`functions/index.js` + `functions/thought-compass-followup.js` + `functions/prompts.js`).
- 명령: `firebase deploy --only functions:callThoughtCompassFollowUp` (또는 전체 functions). **기존 6 callable 무변경**(추가만) — 회귀 위험 낮음.
- **client보다 먼저 배포 권장**: 미배포 상태에서 client가 호출하면 `ThoughtCompassAI`가 null→NEXT로 안전 진행(진행 차단 X)하지만, AI 후속질문 기능은 동작 안 함. 완전한 기능엔 functions 선배포.

### (b) Rules / Database — **변경 없음**
- editSession/writingGuide/onboarding member·teacher RW는 **기존 rules(database.rules.json)가 이미 허용**. 새 rule 불필요 → `firebase deploy --only database` **불요**.
- (Java 환경에서 `tests/rules` emulator로 재확인 권장: `compass.test.js`가 해당 경로 RW 검증.)

### (c) Client — main 병합(= Pages 자동 배포)
- maker.html이 thought-compass-*.js/.css를 로드. 캐시버스터(?v=tcphase1*) 부여됨.
- 순서: **(a) functions 배포 → (c) client main 병합**. (b)는 없음.

### AI secret
- `ANTHROPIC_API_KEY`(Secret Manager) **기존 것 재사용**. 신규 secret **불요**.

## 4. 데이터 migration — 없음
- `onboarding/version`은 신규 작품 생성 시 클라가 lazily write(`_enterMakerAfterPtypeSelected`). 백필 불필요.
- 기존 작품은 onboardingVersion 없음 → optional(강제 안 함, STATE-02). 데이터 변환 0.
- writingGuide/preWriting·editSession 노드는 사용 시 생성. on-load write 없음.

## 5. 신규·기존·복사 작품 정책
- 신규 그림책/텍스트(scenes 빈 상태) → **required 게이트**(onboarding/version=1) + starter 장면은 **완료 후 생성**(PRD 1.1).
- 기존 작품(onboardingVersion 없음 + scenes 존재) → **optional**(상단 진입 버튼). 시작하면 완료까지 강제(STATE-03).
- movie/experience → 미적용(none).
- 복사본 → copiedFrom 마커로 required(`resolveThoughtCompassMode`). ⚠ 단 redeemCopyCode가 `planCopyResetOnboarding`을 호출하도록 거는 부분은 **미연결(미완료)** — §7 참고.

## 6. 동작 변경 점(병합 시 회귀 확인 필수)
- **신규 pb/text 진입 흐름 변경**: 기존엔 ptype 선택 즉시 BASE10 10장면 생성. 이제 compass 게이트로 가로채고 **완료 시 생성**(idempotent `createStarterTemplateForNewProject` 재사용). controller 미로드/classId 없음/scenes 존재 시 기존 즉시 생성으로 폴백(회귀 0 의도).
- firebase.js resume 경유 기존 작품 진입 시 compass 존재 확인 훅 추가(in_progress면 게이트).

## 7. 미완료(후속 Phase 권장) — 의도적 범위 외
- **AI 최종 요약**(R1/R2, WIRE-11 8초 타임아웃→원답 fallback): 현재 완료는 원답 기반. summary 7필드 AI 정돈 미구현.
- **다듬기 메모**(UX-15, 300자) + **브랜치/다듬기 🧭 서랍**(WIRE-13/14): read-only 다시보기까지만 구현(Phase L). 메모/서랍 미구현.
- **읽기 전용 실시간 미러**(WIRE-06/07 draftText 구독): 현재 read-only는 안내+다시확인. live 미러 미구현.
- **제작 튜토리얼 연결**(UX-16/17, D-19): 완료 후 튜토리얼 시작 버튼 미구현(완료 시 maker로 진입).
- **교사 상태/초기화/강제완료 UI**(TEACHER-01~04): foundation plan(`planResetCompassOnly` 등)은 있으나 교사 대시보드 UI 미연결.
- **복사 흐름 onboarding 초기화 연결**: `planCopyResetOnboarding` 미호출(redeemCopyCode 연결 필요). 현재 복사본은 copiedFrom 마커로만 required 판정.
- **rules emulator 실행**: 이 환경 Java 미설치로 NOT_RUN.

## 8. 롤백
- Client: main 병합 commit revert → Pages 자동 원복.
- Functions: `callThoughtCompassFollowUp`는 추가형. client revert 시 호출자 사라짐 → 배포된 채 둬도 무해(membership 게이트). 필요 시 이전 functions 재배포로 제거.
- Rules: 변경 없음 → 롤백 대상 없음.
- 데이터: migration 없음 → 정리 대상 없음(테스트 중 생성된 demo 노드만).

## 9. QA 결과(Emulator E2E 완료 — 상세 `qa_results.md`)
- node --test compass: **189 pass / 0 fail**(16파일) · membership: **20 pass**
- node --check: compass 11 + functions 3 통과 · precommit 통과 · JSON 유효
- functions: 7 callable(기존 6 + 신규 1) 정상 export
- **Rules Emulator(JRE 21) 3회 38/38·0 fail** — editSession/writingGuide/onboarding member·teacher RW, 비member·비로그인 거부, members 직접 write 거부, 학급 격리. (이전 보고의 "Java 미설치 NOT_RUN"은 **해소**: JRE 21 복구·실행.)
- **Emulator E2E**: 신규 그림책/텍스트 게이트·완료·BASE10·answers 7 보존, copy required, movie 제외, AI 4분기(stub), 모르겠어요 유예, editSession acquire/readonly/takeover/release, clearAll 보존, 반응형. **이 과정에서 P1×4·P2×1 발견·수정**(§1 QA 커밋).
- 원본 PB-MOOD 5파일: `cmp` 동일(shasum `e95ac358…`) **보존**.

## 10. 최종 상태
feature branch push 완료. **main 병합·Firebase 배포·Pages 활성 안 함.** 승인 후 §3 순서로 배포.
판정: **READY_FOR_DEPLOY_APPROVAL_WITH_AI_SMOKE_PENDING** — emulator E2E·**2-UID 동시성**·자동회귀·rules·PB-MOOD 통과. 남은 실검증은 **실 Anthropic 응답(functions 선배포 후 AI smoke 1~3회)** 뿐(stub로 로직 검증 완료). 실 maker happy-path는 운영자 확인 완료(게이트·7질문·검토 렌더).
- **advisory-lock 결정 필요**: editSession은 UI 집행 락(패자 store 직접 write는 rules 미차단). 강화하려면 writingGuide write를 editSession 편집자로 제한하는 **rules 변경+회귀**(별도 Security Phase). 미강화 시에도 정상 UI 흐름에선 단일편집 보장.
- 배포 순서(재확인): (1) `firebase deploy --only functions:callThoughtCompassFollowUp` (2) **AI smoke 1~3회** (3) client main 병합(=Pages 자동) (4) 운영 smoke. database 배포 불요·신규 secret 없음.
