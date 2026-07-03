# SCENE-PUBLISH-PRINT-FOLLOWUP-3 — 가로 모드 밀림 + 표지 ☒ + 배경 미인쇄 수정

- 일자: 2026-07-03 · 기준: origin/main `9e7d3a4` · client-only
- 판정: **SCENE_PUBLISH_PRINT_FOLLOWUP_3_LIVE_PASS**

## 사용자 인쇄 미리보기 스크린샷 3장에서 확인된 것
1. **레이아웃 = 가로 모드** 상태였음 — FOLLOWUP-2의 950px 고정 예산은 A4 **세로** 기준이라,
   가로 A4(콘텐츠 ~730px)에서는 페이지마다 넘쳐 무대 하단 조각+선택지가 다음 장으로 밀림
   (break-inside:avoid도 페이지보다 큰 요소는 강제 분할됨).
2. 표지의 ☒는 깨진 이미지가 아니라 **그림 없는 표지 장식 글리프(⸙)가 폰트에 없어 투피로**
   찍힌 것(0000 표지는 그림 없는 작품). ?print=pb 자동 진입 자체는 실작품에서 정상 작동 확인.
3. '배경 그래픽' 체크 OFF — 이 상태로 실제 인쇄하면 말풍선 흰 배경이 미인쇄될 위험.

## 수정 (pb-ai.css + picturebook-print.js 1줄)
- **페이지 예산 950px → 96vh**: 인쇄에서 vh=페이지 박스 기준이라 **세로/가로 용지 자동 대응**.
  (이전 vh 문제는 min-height+avoid 부재 조합이 원인 — 지금은 height 고정+overflow:hidden+
  avoid라 초과·분할 불가.) 표지에도 hidden+avoid 추가.
- **배경 인쇄 강제**: 말풍선·제목 오버레이·번호 배지에 `print-color-adjust: exact` —
  '배경 그래픽' OFF여도 흰 배경/테두리가 인쇄됨.
- 그림 없는 표지 장식 글리프 제거(여백이 자연스러움·투피 방지).

## 검증 (실 viewer.html · 실 0000 AI 이미지 · 표지 그림 없음 재현)
- **A4 세로 21p · A4 가로 21p · 배경 그래픽 OFF 21p — 세 조건 모두 N+1** (장면당 1페이지).
- **가로 모드 직접 육안 확인**(사용자 요청): 페이지 762px ≤ 페이지 박스 794px,
  무대(그림+말풍선)+선택지 2칸이 **같은 페이지 안** — 스크린샷·계측(choicesBottomInPage true) 일치.
- 표지: 투피/장식 없음·제목/부제/모둠/날짜 정상.
- afterprint 정리·타 gate 충돌 0·테스트 462/462·원본 write 0·AI 호출 0.
- 참고: 실팀 0000의 감상 로드는 익명 세션에선 비공개라 거부(정상 rules) — 사용자 브라우저
  (maker UID)에서는 스크린샷처럼 로드됨. 검증은 실 CSS+실 AI 이미지 조건으로 수행.

## 남은 후속
- 실프린터 1회 · aiChecks rules 승인 대기.

## 버스터
`scenepubfix3` — pb-ai.css·picturebook-print.js(viewer.html).
