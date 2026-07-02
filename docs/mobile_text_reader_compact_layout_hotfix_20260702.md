# 모바일 텍스트 감상 독서형 compact 레이아웃 hotfix

- 일자: 2026-07-02
- 성격: 클라 CSS hotfix(viewer.css) · deploy 0 · 실 AI 0 · DB 0 · rules/functions 무변경
- 판정: **`MOBILE_TEXT_READER_COMPACT_LIVE_PASS`**(본문 독서 화면) + 표지는 별도 설계 후속

## 지난 mobiletextdrawfix1이 부족했던 이유
지난 패치는 모바일에서 `.text-page` 비율 고정(210:297)을 풀고 **`height:100%`로 화면을 채웠다**. 그 결과 **짧은 본문에서도 카드가 화면 전체**를 차지 → 본문(flex:1)이 위를 다 먹고 선택지가 바닥으로 멀리 밀려 "답답/빈 공간 큼". 실기기(iPhone)에서 여전히 비효율적.

## 이번 수정 (viewer.css `@media (max-width:600px)`)
카드를 **내용 기반 compact 독서형**으로:
- `.scene-screen--text-paged { padding:10px; place-items:center }` — 카드를 화면 중앙 배치.
- `.text-page { aspect-ratio:auto; width:100%; height:auto; max-height:100% }` — 내용 높이(화면 안 상한).
- `.text-page .text-card { height:auto; max-height:100%; padding:18px 18px 16px }` — viewer.css:6668 `height:100%` override → 내용 기반.
- `.text-card__body { flex:0 1 auto; max-height:58dvh; margin-bottom:14px }` — **그로우 금지**(짧으면 카드가 줄어 선택지가 본문 바로 아래) + 긴 본문만 58dvh 상한 → 내부 스크롤(min-height:0·overflow-y:auto는 v03-modes HOTFIX-LAYOUT).
데스크톱/태블릿(>600px)은 기존 고정 페이지 유지.

## before/after 수치 (Playwright 390×844·실 viewer.css+v03-modes.css)
| | 이전(height:100%) | 이번(compact) |
|---|---|---|
| 짧은 본문 카드 높이 | 화면 ~전체 | **230px(27% vh)**·중앙 |
| 짧은 본문 본문↔선택지 gap | 큼(바닥으로 밀림) | **14px** |
| 긴 본문 카드 높이 | 100% | **689px(82% vh)**·뷰포트 내 |
| 긴 본문 본문 스크롤 | (버튼 밀림) | **내부 스크롤**·선택지 카드 하단 보존(actionsBottom 747<844) |
- 짧은/긴 본문 모두 actions 카드 안·뷰포트 안·클릭 가능. 콘솔 0.

## 긴 본문 처리
본문 `max-height:58dvh` + `overflow-y:auto`로 본문만 스크롤, 선택지(`flex-shrink:0`)는 카드 하단 유지. 카드 `max-height:100%`로 뷰포트 초과 안 함(Safari 하단바 고려는 dvh 기반).

## 잔상/겹침 조사 (§5)
스크린샷의 희미한 `시작하기`는 **DOM 영구 중복 아님** — `_stageReplaceScene`(viewer-render.js:2596)이 장면 전환 시 이전 장면에 `is-leaving`(position:absolute+fade keyframe)을 주고 **`duration+50ms` 후 remove**한다. 표지→본문 전환 중 이전 표지(시작하기 버튼)가 페이드아웃하며 잠깐 겹친 것을 캡처한 **전환 타이밍 아티팩트**(자동 소멸). 전환 로직은 전 모드 공용이라 이번엔 미변경(기록만). 필요 시 모바일 전환 duration 단축은 별도.

## 표지(cover) — 별도 설계 후속
표지는 본문과 **다른 구조**: `renderCover()`가 그림 없는 표지를 `scene-screen--pb pb--split cover-as-pb cover-as-pb--text` + `.pb-page > .cover-book`(top/center/bottom 3행 그리드)로 렌더(viewer-render.js:233~). 즉 **그림책 클래스 기반 "책 표지" 레이아웃**이라 이번 텍스트(`scene-screen--text-paged`) compact 규칙이 적용되지 않는다. 표지의 "큰 빈 박스"는 cover-book 그리드가 페이지에 의도적으로 제목/장식/시작버튼을 분산한 디자인. 모바일 compact화는 **그림책 표지 디자인 변경**이라 중단 조건("그림책 영향/별도 설계")에 해당 → 이번 루프 범위 밖. `.cover-as-pb--text`/`[data-cover-mode="text"]`에 스코프한 모바일 cover-book 간격 축소를 **다음 설계 루프**로 넘김(이미지 표지·일반 그림책 장면 무영향 보장 필요).

## 검증 요약
- Playwright 390×844: 짧은/긴 본문 compact 수치 확인·actions 클릭 가능·콘솔 0. 스샷 mobile-text-compact-short-body.png.
- 변경: viewer.css(모바일 @media 블록 교체)·viewer.html(캐시버스터 `mobiletextcompact1`). functions/rules/DB/AI 무관.
- ⚠️ NOT_VERIFIED(실기기 픽셀): 실 작품 본문 표시는 실기기 확인 권장(합성 수치 검증 완료).

## 남은 것
- 표지(cover-as-pb--text) 모바일 compact — 스코프 좁힌 별도 설계 루프.
- (선택) 모바일 장면 전환 잔상 완화(전환 duration/opacity).
