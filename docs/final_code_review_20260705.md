# 마감 전 전체 코드 리뷰 — P0~P5 종합 (2026-07-05)

- 기준: origin/main `c3fc3c4` · 분석 범위: 클라이언트 전체(~55k줄) + functions(~5k줄) + rules
- 방법: P0 아키텍처(직접) + P1 저장/P2 렌더링/P3 AI/P4 보안 4개 병렬 심층 분석 → **핵심 주장 전건 원문 교차검증**
- 원칙: 발견 ≠ 수정. "왜 이렇게 됐는가" 먼저. 구조를 건드리는 수정 금지.

## 종합 판정

**마감 차단 요소 없음.** 저장·잠금·원본보존·AI 게이트·rules 핵심 경로는 견고하고,
과거 사건(v113 meta 유실·v125 잠금 오탐·PERF-2 회귀 등)의 교훈이 코드에 주석·패치로
축적되어 있음. 심층 분석이 제기한 고위험 주장 6건은 전부 원문 검증에서 **기각**됨
(아래 §2). 남는 것은 저위험 다듬기 후보 4건(§4)과 관찰 항목(§5)뿐.

## 1. P0 — 아키텍처 판정

| 구조 | 판정 | 근거 |
|---|---|---|
| 바닐라 JS + IIFE + window.* 전역 계약 | (a) 의도적 | 빌드 없는 GitHub Pages 정적 호스팅. 계약 밀도 높음(viewer-render 100곳)이나 일관됨 |
| 지연 번들(edit→img→story→ai 순차, loadOnce) | 양호 | PERF-2 회귀 이력(FIELD-FIX-B)까지 주석으로 관리. 같은 key 'ai'로 중복 로드 0 |
| SW network-only + navigation no-store | (a) 의도적 | 옛 HTML→옛 버스터 캐시 사고 재발 방지. 원칙 명문화 |
| 캐시버스터 `?v=` 누적(viewer-edit ~1,400자) | (c) 선택 | 동작 문제 0. 리셋 가능하나 우선순위 낮음 |
| Firebase config 2벌(firebase.js/teacher-auth.html) | (a) 수용 | apiKey 공개는 Firebase 표준. 변경 시 2곳 동기화만 유의 |

## 2. 기각된 고위험 주장 (원문 교차검증)

심층 분석 결과를 그대로 믿지 않고 전건 재검증한 결과. **이 절이 이번 리뷰의 핵심 산출물.**

| # | 주장 | 기각 근거 (원문) |
|---|---|---|
| 1 | "account `.write`가 전 인증자에 개방(HIGH)" | database.rules.json:48 — `teacher_uid===auth.uid ∥ super_admin` 게이트 존재. 에뮬레이터 79/79와 정합 |
| 2 | "s2 chunk 병합 시 장면 silent drop(높음)" | functions/index.js:1586-1591 — chunk별 target 전수 누락 검사→throw→전체 실패+환불. chunk가 전체 장면을 분할 커버하므로 구조적으로 불가능 |
| 3 | "`dirtyScenes.size===0`→전체 set은 불필요 레거시, 제거 권장" | **제거하면 저장 깨짐.** `pushToFirebase()` 무인자 호출(ui.js:182·sceneRenderer ~10곳)=전체 저장 의미론(장면 추가/삭제/재배열용). firebase.js:935-944는 그 실행 경로 |
| 4 | "작품검사 캐시가 선택지 label 변경 미감지" | functions/index.js:177-192 — hash에 buttons[].label/nextId·choiceA/B·nextA/B·title·body 포함. `choices[]`는 메모리 전용, 저장은 buttons로 역직렬화(viewer-data.js:1470-1521)라 커버리지 완전 |
| 5 | "viewer-ai는 mock 전용(Phase A 미진입)" | 파일 내 옛 PHASE 마커 오독. 실제 텍스트1·2·작품검사 실 Haiku 라이브(`?test=1`만 mock) |
| 6 | "classId 경로 traversal 위험" | RTDB는 `..`를 리터럴 키로 취급 — 분석 에이전트 스스로 철회 |

교훈: rules·저장 계열 자동 분석은 반드시 원문 재확인 후 채택할 것.

## 3. ① 그대로 둠 — 이유 기록

| 항목 | 위치 | 왜 이렇게 됐는가 / 왜 안 고치는가 |
|---|---|---|
| scenes/viewer-meta write=`auth!=null` | rules:62,66 | **알려진 Critical·의도적 보류.** legacy 팀 백필 전 조이면 저장 파손 → SCENES-WRITE-RULES-HARDEN-1(마지막·별도 승인) |
| storage `/images` write=auth만+6MB+MIME | storage.rules:6-12 | 위와 동일 사유(legacy 팀 업로드가 익명 auth). **HARDEN-1 트랙에 storage 강화 포함 권장** — rules만 먼저 조이면 저장처럼 깨짐 |
| PIN 평문 저장 | rules:50 | 클라 직접 read 불가(교사만)·검증은 callable(joinTeamMembership) 서버측·오류문구 존재 비노출. 초등 4자리 PIN에 해시 도입은 과설계 |
| 교사판별 비대칭(rules=claim만, functions=claim+RTDB) | rules:28 vs index.js:1852-54 | rules 평가 중 교차 RTDB read 제약. functions가 상위 보완 계층. 문서화만 |
| aiAuthEnforce log-only | index.js:353-498 | 의도된 soft-launch. 실트래픽 관측 후 ON(기존 계획) |
| imageS2 quota 60 고정 | index.js:97 | PRD §10. 동적 상한은 필요 시 후속 |
| 편집 재렌더=stage.innerHTML 전체 교체(~20 호출처) | viewer-edit.js | 부분 patch 훅 부재의 보수적 선택. video 재사용 등 보호 장치 존재. PERF-AUDIT-1 Critical/High 0 유지 |
| `void offsetWidth` reflow 3곳 | viewer-render.js:2776+ | CSS 애니메이션 리셋 정석. 대안(animation-composition)은 iPad Safari 호환 위험이 더 큼 |
| presentation 객체 통째 update | viewer-data.js:586 | 현재 내부에 타 키 없음 → 실위험 0. nested 확장 시 merge 필요만 기록 |
| maker IDLE 12s vs HB 5s 근사 | state.js:92-94 | 이론적 경합뿐, idle 해제는 명시적 releaseLock. v125에서 실사용 검증됨 |

## 4. ② 안전 수정 후보 — 승인 대기

| # | 항목 | 내용 | 위험 | 비고 |
|---|---|---|---|---|
| C1 | **주석 훼손 복원** | "박은 거 박은…" 무의미 반복 주석 ~72곳/8파일(viewer-ai 35·functions/index 24·adminConsole 4·pb-ai.css 4 외). **전부 주석/CSS 주석 내부 — 문자열·동작 영향 0 확인 완료.** git 히스토리에서 원문 복원 or 문맥 재작성. 이 프로젝트는 주석이 "왜"의 기록이라 효익 큼 | 0 (diff 주석만 검증) | client는 버스터 불요(주석만이라도 파일 변경 시 관례상 갱신 판단) |
| C2 | isOriginAllowed 빈배열 fallback 제거 | index.js:137 `length===0→true`는 fail-open. 현재 배열 비어있지 않아 실노출 0 | 낮 | **functions deploy 필요 → 다음 deploy에 동승**(단독 배포 비권장) |
| C3 | `_saveProjectMetaField` silent fail | viewer-edit.js:2892 — 효과 슬라이더 저장 실패 시 console.warn만. 기존 `_showSaveStatus('❌ 저장 실패')` 패턴 재사용 | 낮 | client-only·수 줄 |
| C4 | TEXT-S2 dormant 훅 정리 | getPublishedImageDisplaySrc 등 항상-원본 반환 호출 3곳 — 기존 "dormant 정리" 백로그와 동일 항목 | 낮 | 선택. 계약 훅 유지가 더 안전하다는 반론도 성립 → 보류 가능 |

## 5. ③ 별도 트랙 / 관찰

- **SCENES-WRITE-RULES-HARDEN-1**: 기존 계획대로 마지막·별도 승인. **범위에 storage.rules 강화(팀 경로 격리)를 함께 포함**할 것 — 같은 legacy 제약, 같은 타이밍이 안전.
- **무인자 전체저장 가림 가능성**: dirty가 남은 상태에서 `pushToFirebase()`(구조 변경)가 호출되면 flush가 부분 update 경로로 빠져 구조 변경이 다음 flush까지 지연될 수 있음(파손 아님·지연). focused 하니스로 재현 확인 후 판단. 지금 수정 금지(저장 코어).
- **연타 시 편집 재렌더 깜빡임**: 실기기(iPad) 관측 후 debounce 조정 판단. 코드 선행 수정 금지.
- **prompt/키 3곳 동기화 SOP**: 나침반 질문·WAQ 타입 변경 시 체크리스트 — 코드 수정 아닌 운영 규칙(이미 MEMORY에 존재, docs화만).

## 6. 적용 내역 (승인 후 실행 — FINAL-REVIEW-FIX-1)

사용자 승인 범위: C1 주석 복원(전체) + C3 저장실패 표시 + 노출 문구 수정. C2(origin fail-open)는
다음 functions deploy 동승 대기. 내부 로그 문자열 ~31곳은 **보류**(동작 바이트 변경이라 별도 승인).

- **주석 복원**: 1차(무의미 반복) 296곳 + 2차(습관어 열화) 367곳+ = **총 ~660줄/20파일**.
  viewer-render 99·mobileTextBranch 122·viewer-ai 107·functions/index 65·firebase 23 등.
- **C3**: viewer-edit.js `_saveProjectMetaField` catch에 `_showSaveStatus('❌ 저장 실패')` 추가(1줄).
- **노출 문구 7곳**(학생 5·교사 1·공용 1): viewer-ai 적용모달 "일괄 박을→선택할 수 있어요" ·
  adminConsole 삭제확인 "다르게 박으면 삭제 박지 X→입력하면 삭제되지 않아요" · viewer-edit 권한안내
  "박지 못하면→안 되면" · viewer-edit 그리기 "박을→넣을 글자" · mobileTextBranch 점검사유
  "연결 안 박힘→연결되지 않음"·배치배너 "위치 박음→이동" · mediaManager 업로드오류 "박을→찾을 수 없어요".
- **버스터**: viewer-edit(metasavefail1) · viewer-ai/adminConsole/mediaManager/mobileTextBranch(uitextfix1).
  주석만 바뀐 파일은 버스터 불요(동작 동일).

### 기계 검증 (acorn 토큰 스트림 비교)
- 주석-only 10개 JS: **HEAD와 토큰 완전 동일**(주석/공백 외 0바이트) — viewer-render 16,089토큰 등 전부 PASS.
- 문자열 수정 5개 JS: **"HEAD+의도된 치환"과 토큰 완전 동일** — 승인 외 변경 0 증명.
- CSS 3개: 주석 제거 비교 PASS. node --check 15/15. maker/viewer.html diff=버스터 줄만.
- 잔존 "박" = 보류한 내부 로그 문자열 + 정상 단어(박스 등)뿐.

## 7. 검증 기록

- rules 원문 Read(46-79행)·storage.rules 전문·index.js 1549-1678/168-214행 직접 대조
- `pushToFirebase()` 무인자 호출처 전수 grep(10곳)
- 주석 훼손: 문자열 리터럴 히트 0 확인(grep 패턴 검사) — 주석 한정 확정
- 훼손 유입 커밋: `84ad520`부터 다수 커밋에 걸쳐 누적(git log -S)
