# 1단계 그림책 — 완성 대기화면 설계 (LV1-WAIT-1)

작성 2026-09-05 · 상태: **설계(승인 대기)** · 모드: 안전(서버 노드 신설 → 조사·구현 분리, 배포 전 승인)

## 0. 결정 요약

| # | 결정 | 근거 |
|---|---|---|
| 흐름 | 나침반 → **주인공 선택(나침반 마지막 카드)** → 글 초안(30초) → 그림 13장 → **완성** 까지 한 화면에서 기다린다 | 글은 기다리고 그림은 안 기다리던 비대칭이 고아 버그의 뿌리(2026-08-14 심사6) |
| 3번(선택 위치) | **B: 선택을 초안 앞으로**. 사용자 조건 = "버그만 안 생기면" | 초안↔배치 사이에 UI 단계가 없어져 "글은 있는데 그림 트리거가 사라지는 틈" 자체가 소멸 |
| 6번(브랜치 화면) | **유지**(허브). 완성 화면의 [📖 내 동화책 보기] 버튼만 책(감상)으로 | 나침반·세션 복원·복귀·환영 튜토리얼·교사 리셋이 전부 maker에 매달려 있음 |
| 정정 | "그리는 동안 글이 써진다"(overlap)는 **이번엔 제외** | 초안은 서버가 아니라 **클라가 scenes를 쓴다**(`_applyStoryDraftStarter`). 초안 중 화면을 옮기면 초안 유실+횟수 소모. 서버가 scenes를 직접 쓰는 건 원본 쓰기 가드가 걸린 별도 안전 작업. 초안은 30초라 먼저 끝내고 이동 |

## 1. 목표 / 비목표

- 목표: ①그림이 안 생기는 고아 상태가 **구조적으로 불가능** ②아이 눈에 "만들어지고 있다"가 항상 보임 ③탭을 닫거나 새로고침해도 같은 자리로 복귀 ④서버 rules 무변경 ⑤비용 불변(같은 13장)
- 비목표: 브랜치 화면 제거 · 서버가 scenes 직접 쓰기(overlap) · 초안 프롬프트 변경 · 2·3단계 변경 · 교사 콘솔 진행 표시(후속 옵션)

## 2. 흐름

### 지금 (코드 기준)
```
나침반 9문항 → 가치 3택1 → 완료 저장 → 🌱 초안 30초(오버레이)
  → [환영 튜토리얼 await]  ← 여기서 탭 닫으면 아래가 영영 안 옴
  → 주인공 선택창(showMakerConfirm) → 그림 배치 fire-and-forget(좌하단 배지·8초 폴링)
```
트리거가 sessionStorage 플래그 2종(`pbLv1NeedsProtagChoice`·`pbLv1ProtagDraw`)+소비처 3곳(review `_complete`·부팅 6초·viewer 게이트)에 걸쳐 있고, 탭이 닫히면 플래그가 함께 사라진다.

### 새 흐름
```
나침반 9문항 → 가치 3택1
  → 🎨 "주인공을 직접 그릴래요?"  (나침반 마지막 카드·바깥클릭 없음·viewer-meta/lv1Protag 기록)
  → 완료 저장 → 🌱 초안 30초  (대기화면 1단계 "이야기를 쓰고 있어요")
  ├ AI가 그려요  → 배치 호출 → 대기화면 2단계 "그림을 그리고 있어요 n/13"(장면 도착마다 페이지 채워짐)
  │               → 완성 "동화책이 완성됐어요!" [📖 내 동화책 보기] → 감상(viewer)
  └ 내가 그려요  → 스튜디오(viewer)로 이동 → 그리기+특징 한 줄 → 저장/건너뛰기
                  → 배치 호출 → 대기화면 2단계(viewer 안) → 완성 → 책이 그 자리에
```
재진입(탭 닫힘·새로고침·다음 날): 화면은 **서버 상태만 읽어** 아래 §5 규칙으로 같은 자리에 다시 붙는다. 클라 플래그 0.

## 3. 데이터

### 3.1 `aiVariants/imageJob` — 서버가 쓰는 진행 노드(신설)
```json
{ "v": 1, "status": "running|done|partial|limit|error",
  "total": 13, "done": 7, "failed": { "9": "SAFETY_BLOCKED" },
  "startedAt": 0, "updatedAt": 0, "finishedAt": 0, "by": "uid" }
```
- 위치 근거: `aiVariants`는 rules가 `.read: true / .write: false` → **학생이 읽을 수 있고 아이가 지울 수 없다. rules 무변경.** (`aiUsage`는 학생 read 불가 — 2026-08-14 확인. `viewer-meta`는 학생 쓰기 가능이라 서버 진실로 부적합)
- 배치(비단일) 호출만 쓴다. 🔁 단일 재생성은 건드리지 않는다.
- `done`은 skipped(이미 있음)+generated 누적. 화면의 진짜 진행률은 이 값이 아니라 **`aiVariants/image` 실제 도착 수**(§5 truth). job은 상태(running/끝남/사유)만 준다.

### 3.2 `viewer-meta/lv1Protag` — 아이의 선택(신설·클라 쓰기)
`'ai' | 'draw'`. 선택 카드에서 즉시 기록(완료 저장 전). 기존 `protagonistRef/Desc` 패턴과 같은 노드·같은 권한(`.write: auth != null`).

### 3.3 건드리지 않는 것
`aiVariants/image/{sid}/s2`(그림 결과·AI 기본 표시), `characterSheet`, `aiUsage`(총량·lock), `scenes/*/picturebookBodyBox` 프리셋, rules 전체.

## 4. 서버 변경 (`functions/index.js` — 안전 모드)

| 지점 | 변경 |
|---|---|
| `generateStoryImages` lock 획득 직후 | `imageJob` = running(total=targetIds.length, done=0, startedAt/updatedAt=now, failed={}) — **transaction 성공 시에만**. BUSY 반환 경로는 무기록 |
| workOne 성공(`generated++`)·skip(`skipped++`) | `imageJob/done` transaction +1, `updatedAt`=now |
| workOne 실패(failed.push) | `imageJob/failed/{sid}`=code, `updatedAt`=now |
| 종료(finally 직전) | status = done(전부) / partial(failed>0 또는 done<total) / limit(limitReached∥globalLimitReached) / error(예외), `finishedAt`=now |
| `adminResetPicturebookWork` | 삭제 목록에 `viewer-meta/lv1Protag` 추가(`aiVariants` 통째 삭제라 imageJob은 이미 포함) |
| `teacherCloneTeamFull` | 복사 대상 `aiVariants`에서 `imageJob` 제외(복제본이 남의 진행 상태를 물려받지 않게) |

- 전부 **추가·부수효과 없음**: 클라가 job을 안 읽어도 종전과 동일 동작(구버전 탭 안전).
- 540초 인스턴스 종료로 finally가 못 돌면 status가 running으로 남는다 → 클라 stale 규칙(§5, 10분=`STORY_IMAGE_LOCK_STALE_MS`와 동일)이 처리.
- 초안 콜러블(`studentStoryDraft`)은 **무변경**(desc→초안 반영은 §10 후속).

## 5. 클라 — 상태 도출(순수 함수, 이 설계의 핵심)

입력(전부 학생 rules로 읽을 수 있는 경로): `viewer-meta/picturebookLevel`, `viewer-meta/lv1Protag`, `viewer-meta/protagonistRef`, `scenes`, `aiVariants/image`, `aiVariants/imageJob`, `classes/{cid}/aiSettings`(read true), `now`.

```
targets = scenes 중 type≠cover ∧ body.trim()≠''        (서버 판정과 동일 술어 — 함수 1개로 공유)
have    = targets 중 aiVariants/image/{sid}/s2.url 있음  (Object.keys 개수 아님 — 대상 외 키·null 제외)
running = job.status==='running' ∧ now−job.updatedAt < 10min

if level≠1                                   → NONE
if targets.length===0                        → NONE      (초안 전 — 나침반이 소유)
if have===targets.length                     → DONE
if aiSettings.modes.imageS2!==true ∨ !enabled→ OFF       (그림 없이 진행·안내 1회·재진입 무소음)
if job.status==='limit'                      → LIMIT     (그림 없이 진행·안내 1회)
if lv1Protag==null ∧ have===0 ∧ !running     → CHOICE    (선택 카드 다시)
if lv1Protag==='draw' ∧ !protagonistRef ∧ have===0 ∧ !running → DRAW (스튜디오 게이트·건너뛰기 있음)
if running                                   → WAITING   (n=have/total, 실패 sid 표시)
else                                         → RESUME    (배치 호출 → WAITING)  ※ 오늘까지의 고아도 여기로 흡수
```
- RESUME 재호출은 **페이지 로드당 2회 상한**, 그 뒤 ESCAPE(탈출구) 노출. 서버 dedup(promptVersion 일치 skip)이라 재호출 비용 0.
- 트리거 소유권: AI 경로=대기화면 모듈 / 그리기 경로=스튜디오 게이트(저장·건너뛰기) / 재진입=위 규칙. 세 곳 다 같은 함수(`Lv1Book.fireBatch`) 하나를 부른다.
- 이중 호출: 서버 lock이 BUSY로 되돌린다(생성 0·비용 0). 클라는 BUSY를 WAITING으로 취급.

### 5.1 대기화면 모듈 `lv1-book-wait.js` (maker·viewer 공용 1벌)
- `aiVariants/image`·`aiVariants/imageJob` **구독(on)** — 폴링 폐기. 도착한 장면은 즉시 썸네일로 채워진다(13칸 책 페이지 그리드).
- 문구: 1단계 "이야기를 쓰고 있어요(30초)" → 2단계 "그림을 그리고 있어요 n/13 (3~4분)" → 완성 "동화책이 완성됐어요!" [📖 내 동화책 보기]
- 닫기 없음(바깥 클릭·ESC 무시 — FORCE-CHOICE-1 원칙). 탈출구는 §6.
- z-index: 나침반(100001)·환영(100005)보다 위, confirm(100066)보다 아래 → 100050.
- admin=1 · test=1 · 교사 세션은 표시하지 않는다(상태 도출은 하되 화면 없음).

### 5.2 나침반 마지막 카드(선택)
`thought-compass-review.js` `_complete`의 가치 3택1(`_runStoryValueStep`) 바로 뒤에 `_runProtagChoiceStep`(1단계만). 같은 오버레이 스타일(z 100040)·카드 2장 [✏️ 내 주인공 그리기] [🎨 AI가 그려요]. 선택 즉시 `viewer-meta/lv1Protag` 기록 → 완료 저장 → 초안. 완료 저장 전 이탈 시 나침반은 inProgress로 남아 재진입 때 카드가 다시 뜬다(멱등).

### 5.3 스튜디오 게이트(viewer) state화
`_openLevel1ProtagGate`는 sessionStorage 대신 §5 DRAW 상태로 연다. 저장(`_saveProtagonistRef`)·건너뛰기 → `Lv1Book.fireBatch` → 같은 대기화면. 건너뛰기는 `lv1Protag='ai'`로 갱신(재진입 때 다시 안 묻게).

### 5.4 환영 튜토리얼 위치
1단계는 `_complete` 안의 `TutorialWelcome.maybeShow`를 **건너뛰고**, DONE에서 [📖 내 동화책 보기]를 누른 뒤 viewer 진입 훅(기존 `viewer-entry` 튜토리얼 완료 훅)에 맡긴다. 대기화면 위에 튜토리얼이 겹치는 z 경합을 원천 차단. (기다리는 동안 튜토리얼 보기는 §10 후속)

## 6. 종료 상태 4종 + 탈출구

| 상태 | 화면 | 다음 |
|---|---|---|
| 전부 완료 | "동화책이 완성됐어요!" | [📖 내 동화책 보기] → viewer 감상 |
| 일부 실패(안전 차단·제공자 오류) | "12장 완성 · 1장은 만들지 못했어요" + 실패 장면 표시 | [📖 보기] (실패 장면은 다듬기 🔁로 — 빈 장면 🔁는 무료: REGEN-METER-1) |
| 한도·모드 OFF | "선생님이 그림 만들기를 아직 안 켰어요 / 횟수를 다 썼어요" | [글부터 다듬기] → 그림 없이 진행. 재진입 무소음 |
| 타임아웃 | 6분 경과 ∧ 미완 → 탈출구 노출 | [그림은 나중에 이어서 — 글부터 다듬을래요] → 백그라운드 강등(재진입 때 §5 RESUME이 이어 만듦) |

탈출구를 누르지 않는 한 대기화면이 기본. LV1-IMAGE-RESUME-1(2026-08-14)의 "조용한 재개"는 §5 RESUME으로 흡수되어 탈출구 이후의 안전망이 된다.

## 7. 폐기 목록

| 대상 | 위치 |
|---|---|
| sessionStorage 플래그 `pbLv1NeedsProtagChoice`·`pbLv1ProtagDraw` + 2h 신선도(PENDING-FRESH-1) | mobileTextBranch.js 2846~2857·3029~3040, viewer-edit.js `_lv1PendingDrawInfo`/`_clearLv1PendingDraw` |
| 부팅 6초 재소비(감사 #27) | mobileTextBranch.js 2908~2927 |
| review `_complete`의 `__runPendingLv1ProtagChoice` 호출 | thought-compass-review.js 547~551 |
| `_promptLv1ProtagonistChoice`(showMakerConfirm 창) → 나침반 카드로 대체 | mobileTextBranch.js 3017~3050 (FORCE-CHOICE-1 옵션은 showMakerConfirm에 남김) |
| 진행 배지 2벌 `_startStoryImageBadge`(maker)·`_maybeStartLv1ImageBadge`(viewer)·8초 폴링·12분 상한·`_imgBadgeSub` | mobileTextBranch.js 2760~2802, viewer-data.js 1526~1590 |
| 토스트 "그림도 만들고 있어요! 조금 뒤 [감상해 보기]에서" | mobileTextBranch.js 2890 |
| LV1-IMAGE-RESUME-1 훅(별도 setTimeout) — 판정 로직은 §5로 이전 | mobileTextBranch.js 2929~3010 |
| 1단계 카드 그림 자리 분기(LV1-NO-UPLOAD) — CSS `.pb-linear-locked .card-image-area{display:none}`로 이미 죽은 코드 | sceneRenderer.js 433~450 |
| 문구 5곳: "글이 먼저 오고, 그림은 뒤이어" / "완성되면 [▶️ 감상해 보기]에서" / "브랜치 화면에 나갔다 들어오면" / "장당 1분 정도"(×2) | mobileTextBranch.js 2735·2767·2780·2795·2800, viewer-data.js 1583 |
| 환영 슬라이드 1단계 문구 "글과 그림을 예쁘게 다듬어 보아요" → 완성 뒤 진입 기준으로 손질 | tutorial-content.js 49 |

유지: 서버 배치 본체(lock·팀 24·전역 500·dedup·bodyBox 프리셋·안전 스캔), 🔁 단일 재생성(+계량·심사반 면제), characterSheet·protagonistRef/Desc·비전 설명, AI 기본 표시(AI-DEFAULT-VIEW·PUBLISH-LV3-ONLY), `showMakerConfirm.forceChoice`.

## 8. "버그 안 생기게" 원칙 (설계 불변식)

1. **진실은 하나**: 그림 유무 = `aiVariants/image/{sid}/s2.url`. job·플래그·세션은 보조. 화면 진행률은 항상 실제 도착 수.
2. **상태 도출은 순수 함수**: 입력 스냅샷 → 상태 enum. DOM·타이머·네트워크 없음 → 표 기반 단위 테스트 가능. 화면과 트리거는 이 함수의 출력만 소비.
3. **트리거는 멱등**: 몇 번 불려도 서버 lock+dedup으로 결과 동일. 재호출 상한(페이지당 2회)으로 조용한 폭주 차단.
4. **클라 영속 플래그 0**: sessionStorage/localStorage에 흐름 상태를 두지 않는다(오늘 버그의 원인 부류 제거).
5. **stale 규칙 단일값**: 10분(서버 lock stale과 동일). running이 10분 무갱신이면 죽은 것으로 본다.
6. **읽기 경로는 학생 rules로 검증된 것만**: viewer-meta·scenes·aiVariants·aiSettings. `aiUsage` 금지.
7. **구버전 탭 안전**: 서버 job 쓰기는 추가 전용 → 옛 클라(배지 흐름)도 종전대로 동작. 배포 순서 = 서버 먼저, 클라 나중.
8. **대상 술어 1개 공유**: targets 판정 함수를 maker·viewer가 같은 모듈에서 import. 서버 술어와 문자 그대로 일치.

## 9. 검증 계획

- **단위(순수 함수)**: §5 표의 모든 행 + 경계(stale 9분59초/10분·have=total−1·job 없음·job limit·모드 OFF·lv1Protag 없음·draw+ref 없음·재호출 3회째 ESCAPE). 목표 20케이스 이상, 하니스는 tests/ 정식 등록.
- **서버(하니스)**: imageJob 4지점 쓰기·BUSY 무기록·partial/limit/error 분기·single 무기록·reset 목록·clone 제외.
- **실환경 PoC(연습반 0000·테스트 팀 2개)**: ①AI 경로 완주 ②그리기 경로 완주 ③대기 중 탭 닫고 재진입(WAITING 재부착) ④선택 카드에서 이탈 후 재진입(CHOICE 재표시) ⑤스튜디오 이탈 후 재진입(DRAW 재표시) ⑥모드 OFF(교사 토글)→OFF 화면 ⑦job을 running·updatedAt=20분 전으로 심어 stale→RESUME ⑧구버전 탭(버스터 전) 동시 열림 무영향 ⑨심사반 9999 무영향(AI 잠금·재진입 무소음) ⑩PII 마스킹 캡처.
- **실측(첫 수업)**: 동시 N팀 배치 소요 시간(13장 단독 3분13초~3분45초·5회 실측). 6팀 동시에 6분 넘으면 탈출구 문구/타임아웃 조정.
- **회귀**: 2·3단계(배치 패널·🔁·AI 마감) 무변경 스모크, `node --check`·버스터 `--check`.
- **롤백**: 서버 job은 남겨도 무해. 클라 revert+버스터+`app-version` 강제 새로고침으로 3분 내 복귀.

## 10. 후속 옵션(이번 범위 밖)

- 아이가 적은 주인공 특징(desc)을 초안 콜러블에 전달 → 글의 인물 묘사까지 일치(콜러블 선택 필드 1개).
- 서버가 scenes를 직접 써서 "그리는 동안 글 쓰기"(overlap) — 원본 쓰기 가드 재설계 필요, 별도 안전 작업.
- 기다리는 동안 환영 튜토리얼/표지 제목·지은이 쓰기.
- 교사 콘솔 팀별 `n/13` 진행 표시(imageJob 구독만으로 가능).
- 1단계 완성 후 도착지를 감상이 아니라 다듬기로 할지(사용자 취향).

## 11. 순서

1. 승인 → 2. 서버(job 4지점+reset+clone) 하니스 → 배포(추가 전용) → 3. 클라 순수 함수+테스트 → 4. 대기화면 모듈+나침반 카드+게이트 state화(폐기는 같은 커밋에서) → 5. 연습반 PoC 10항목 → 6. 문구·튜토리얼 정리 → 7. 첫 수업 실측.
