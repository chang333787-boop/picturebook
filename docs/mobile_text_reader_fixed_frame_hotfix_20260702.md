# 모바일 텍스트 감상 고정 독서 프레임 hotfix

- 일자: 2026-07-02
- 성격: 클라 CSS hotfix(viewer.css·본문 장면만) · deploy 0 · 실 AI 0 · DB 0 · rules/functions 무변경
- 판정: **`MOBILE_TEXT_READER_FIXED_FRAME_LIVE_PASS`**

## 1. compact가 불편했던 이유
직전 `mobiletextcompact1`은 모바일 본문 카드를 **내용 기반 height:auto + place-items:center**로 만들었다. 그 결과 장면마다 본문 길이에 따라 **카드 높이/위치가 달라져** 화면이 왔다갔다 → 감상 흐름이 흔들리고 멀미. 또 짧은 본문은 카드가 중앙에 작게 떠서 **상단에 큰 여백**이 생겼다.

## 2. 수정 파일 / 3. 고정 프레임 정책
`viewer.css` `@media≤600px` 본문 블록을 compact→**고정 독서 프레임**으로 교체(`.scene-screen--text-paged` 스코프·표지 무관):
- `.scene-screen--text-paged { padding: 8px 10px 10px; place-items: stretch; }` — 중앙정렬→프레임 채움(상단부터), 상단 여백 축소.
- `.text-page`, `.text-card { height:100%; max-height:100% }` — 장면 길이와 무관하게 프레임 고정.
- `.text-card__body { flex:1 1 auto; max-height:none; }`(+ v03-modes의 `min-height:0; overflow-y:auto`) — 프레임을 채우고 길면 본문만 내부 스크롤.
- `.text-card__actions { flex:0 0 auto }` — 항상 카드 하단 안정.

## 4. 상단 여백 축소
`place-items:center → stretch` + padding-top 10→8px → 카드가 화면 상단(top≈9px)부터 시작. compact의 "중앙에 뜬 작은 카드 + 상단 큰 여백" 제거.

## 5. 본문 내부 스크롤 / 6. 선택지 안정화
긴 본문은 `.text-card__body`만 스크롤, 선택지(`flex:0 0 auto`)는 카드 하단 고정. 짧은 본문도 선택지 위치 동일(안정).

## 7. 표지 회귀 없음
표지는 `cover-as-pb--text`(그림책 구조) 스코프의 별도 규칙(`mobiletextcover1`)이라 이번 `.scene-screen--text-paged` 변경과 독립 → 표지 compact 유지(규칙 4건 그대로).

## 8. before/after 수치 (Playwright 390×844·실 viewer.css+v03-modes.css)
장면별(짧은/중간/긴) 안정성:
| | 짧은 | 중간 | 긴 | 편차 |
|---|---|---|---|---|
| cardTop | 9 | 9 | 9 | **0** |
| cardH | 824 | 824 | 824 | **0** |
| actionsBottom | 814 | 814 | 814 | **0** |
| body 내부 스크롤 | X | X | **O** | — |
→ 카드 top/height/선택지 위치 **장면 간 편차 0**(멀미 해소). 긴 본문만 내부 스크롤. actions 뷰포트 내(814<844). cardTop 9px = 상단 여백 최소.
- 트레이드오프: 고정 프레임 + 선택지 하단 고정이므로 **짧은 본문은 본문과 선택지 사이에 여백**이 생김(사용자 요청 "선택지 항상 안정적인 아래 위치"의 결과·안정성 우선).

## 9. 테스트
node/CSS·Playwright 390×844 안정성 수치·긴 본문 스크롤·actions 클릭영역·콘솔 0. 표지 규칙 4건 유지 확인. 데스크톱/태블릿(>600px)은 @media 밖이라 기존 고정 페이지 유지.

## 10. 스크린샷
mobile-text-fixedframe-short.png.

## 11. cachebuster / commit·main·live
`mobiletextfixedframe1`(viewer.css). functions/rules/DB/AI 무관·8000 미접촉.

## 남은 것
- 실기기에서 장면 넘기며 카드 안정성(멀미 해소)·상단 여백 최종 확인.
- (선택) 짧은 본문의 본문↔선택지 여백을 더 좁히고 싶으면 프레임 상단정렬 유지하며 선택지를 본문 근접 배치하는 변형 검토(단 선택지 위치 안정성과 상충 — 별도 판단).
