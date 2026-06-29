# imageS2 운영 smoke 계획 (배포 직전, 승인 후 실행)

> 2026-06-29. feature `feature/image-s2-first-generation`. **이 문서는 계획이다. 아래 절차는 사용자 승인 후 별도 루프에서만 실행한다.**
> 실행 전제: 개인정보 검토 완료 + secret 등록 + Functions 배포 + aiSettings 플래그 ON.

## 0. 사전 게이트 (모두 충족해야 smoke 시작)
1. 🔴 개인정보 검토 결론(국외 이전·미성년·ZDR) — `image_s2_privacy_notice_candidate.md` TODO 해소.
2. secret 등록(`IMAGE_OPENAI_API_KEY`) — `image_s2_deployment_gates.md` §배포 명령.
3. Functions 3종 배포.
4. aiSettings 플래그 ON(테스트 학급만).

## 1. 대상 (작게)
- **테스트 학급 / 테스트 팀** 또는 **비공개 작품**만. 실 학생 공개 전.
- **이미지가 있는 장면 1~2개만**.

## 2. 절차
| # | 단계 | 확인 |
|---|---|---|
| 1 | secret 등록 | `functions:secrets:get IMAGE_OPENAI_API_KEY`로 존재 확인(값 노출 X) |
| 2 | Functions 3종 deploy | deploy 성공·함수 ACTIVE |
| 3 | aiSettings 플래그 ON | 테스트 학급 `modes.imageS2=true`(+권장 플래그) |
| 4 | 교사 세션에서 'AI 그림책 마감' 버튼 노출 확인 | 교사만 보임 |
| 5 | **장면 1개만** 변환 시작 | `callImageAiS2` 호출 |
| 6 | 진행률 확인 | job 노드(`aiVariants/imageJobs/{jobId}`) 폴링 정상 |
| 7 | 결과 생성 확인 | `aiVariants/image/{sid}/s2` 에 url 기록 |
| 8 | 원본 ↔ AI 비교 | `resolveSceneImageSource` 미리보기, 원본 무수정 |
| 9 | AI 결과 사용(적용) | `callApplyImageS2Selection({selected:'s2'})` → `aiVariants/imageSelections/{sid}` 기록 |
| 10 | 새로고침 후 선택 유지 | selection 노드 유지 |
| 11 | 원본 유지로 복귀 | `selected:'original'` 적용 → 정상 복귀 |
| 12 | 비용 로그 확인 | Functions 로그 `[ai/imageS2] result` status/code(원문 미노출) |
| 13 | 오류 로그 확인 | 콘솔/Functions 오류 0 |
| 14 | 학생 세션 버튼 미노출/생성 거부 확인 | 학생은 생성·적용 불가(서버 `permission-denied`) |

## 3. 중단 기준 (하나라도 발생 시 즉시 중단·롤백 검토)
- 원본 이미지 덮어쓰기 발생
- 학생에게 생성/적용 노출
- 비용 폭주(예상 장당 ~$0.05 대비 과다)
- 300초 timeout
- 결과 저장 실패
- 선택 후 새로고침 시 불일치
- 개인정보 gate 무시
- 콘솔/Functions 오류

## 4. live 감상 렌더 후속 (이번 범위 아님)
- 현재 AI 선택 결과는 `aiVariants/imageSelections`에 저장되나 **live 감상 렌더에는 미연결**(`resolveSceneImageSource` 함수는 구현, render hook 미연결 — `image_s2_deployment_gates.md` §4).
- smoke에서는 **선택 저장까지만** 검증. 감상 화면 반영은 별도 후속 루프(render resolver 연결 + 기존 image display 경로 전수 조사 + fallback/stale 테스트)에서 진행.

## 5. 롤백
- aiSettings `modes.imageS2=false`로 즉시 차단(생성·적용 게이트 닫힘).
- 필요 시 secret 제거(`functions:secrets:destroy`)로 not-configured 복귀(생성 0).
- 원본은 어떤 경로로도 미수정 — 데이터 롤백 불요.

---

## 6. 실행 결과 (2026-06-29, IMAGE-S2-SECRET-DEPLOY-SMOKE-LOOP — 판정 `IMAGE_S2_DEPLOYED_SMOKE_PARTIAL`)

### 6-1. 완료
| 단계 | 결과 |
|---|---|
| Secret 등록 | ✅ 사용자가 `IMAGE_OPENAI_API_KEY` 등록(version 1 ENABLED). 값 미열람. |
| Functions 배포 | ✅ `callImageAiS2`·`callStartImageS2Batch`·`callApplyImageS2Selection` 3종 **Successful create**(v2 callable·asia-northeast3·nodejs20·project picturebook-8731f). secret accessor 권한 자동 부여. |
| Reachability | ✅ 미인증 POST → 3종 모두 **HTTP 401**(not-found 아님 = 도달·인증게이트 정상). |
| 배포 전 검증 | ✅ image-s2 단위 **111/111**·node --check 4파일 OK·repo secret 스캔 0. |
| 플래그 | ⏪ junglim(class_2026_junglim_1) `modes.imageS2` 일시 ON 후 **원복(false)**. 백업 보관. 현재 전 학급 imageS2=OFF(안전 기본). |

### 6-2. 실변환 smoke = 보류 (사용자 결정: 배포까지만)
**핵심 제약(이번 루프 구조적):**
1. **교사 UI 클라 코드는 feature 브랜치에만 있고 main 미병합** → 라이브 공개 사이트(GitHub Pages=main)에 'AI 그림책 마감' 버튼이 없음. main 병합은 이번 루프 금지.
2. **교사 신원 = 익명 인증 UID**(`signInAnonymously`). 서버 생성 게이트(index.js:2159)는 `classes/{cid}/meta/teacher_uid === uid` 또는 super_admin 클레임만 통과. 새 브라우저 세션은 새 익명 UID라 기존 학급 교사로 인식 안 됨.
3. 이미지 장면이 실재하는 팀은 junglim/0000(실 학생 작품)뿐이고, 격리 테스트 학급("우리반 만세")엔 이미지 장면 없음.

→ junglim 교사-인증이 불가능하고, 대안(로컬 feature 빌드 + Playwright로 새 비공개 테스트 작품 생성 후 변환)은 사용자가 **이번엔 배포까지만**으로 보류.

### 6-3. 현 운영 상태
- **배포 완료·게이트 OFF**: 함수는 살아있으나 모든 학급 `modes.imageS2=false`라 호출 불가. secret 등록됨. **언제든 ON만 하면 실변환 가능 상태.**
- 원본 데이터 무변경. main 미병합. 전체 공개 안 됨. 학생 미노출.

### 6-4. 다음 루프(실변환 smoke) 선택지
- **A. 새 비공개 테스트 작품 경로**: 로컬 feature 빌드 + Playwright로 새 테스트 학급/팀/이미지 1장 생성(그 세션이 교사) → 그 학급만 imageS2 ON → 실변환 1회(~$0.05). 실 학생 데이터·병합 불필요.
- **B. 통제된 main 병합 경로**: feature→main 병합으로 라이브에 교사 UI 노출 → 교사 실 브라우저에서 junglim 등 실작품 1장 smoke. (전체 공개 아님 — 버튼은 교사 from=maker 세션만.)
- 어느 쪽이든 실변환 시 §2 14단계 + §3 중단기준 적용.
