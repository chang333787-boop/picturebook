# SCENE-PUBLISH-PRINT-FOLLOWUP-2 — AI 그림 잘림 + 선택지 다음 페이지 밀림 수정

- 일자: 2026-07-03 · 기준: origin/main `5be918c` · client-only(CSS만·JS 무변경)
- 판정: **SCENE_PUBLISH_PRINT_FOLLOWUP_2_LIVE_PASS**

## 1. 원인 — 두 증상은 단일 원인
- **AI 그림은 CSS가 자르지 않았다**: 0000 실 s2 이미지 실측 **1536×1024 = 정확히 3:2**
  (무대 비율과 동일), `object-fit: contain` — 픽셀 crop 0. "잘려 보임"의 실체는
  **장면 페이지가 페이지 경계에 걸쳐 무대 하단이 다음 장으로 넘어간 것**(선택지 밀림과 동일 증상).
- **구조 원인 2가지**:
  ① `.pbp-scenepub`(장면 페이지)에 `break-inside: avoid`가 없어 Chrome이 무대와 선택지
     사이에서 자유롭게 분할 가능.
  ② 페이지 예산이 vh 기반(`표지 92vh` 실측 **1033px > A4 콘텐츠 1027px**) — 표지가 한 페이지를
     살짝 넘치며 이후 장면들이 페이지 경계에 걸리는 트리거. (내 이전 검증 mock은 표지 그림이
     작아 이 초과가 재현되지 않았음 — 사용자 실작품 조건에서 드러남.)

## 2. 수정 (pb-ai.css print 블록만)
- **vh 예산 폐기 → 고정 950px**: 표지·장면(scenepub)·text-only(publish) 페이지 전부
  `height: 950px`(A4 콘텐츠 ~1027px 안 안전 여유) — 브라우저 여백/vh 해석 변동 흡수.
- **장면 페이지 = grid [무대 minmax(0,1fr) | split본문 auto | 선택지 auto]**
  + `break-inside/page-break-inside: avoid` + `overflow: hidden` — 무대와 선택지 사이
  page break가 **구조적으로 불가능**(예산 초과 시에도 분할 대신 내부 수납 = 선택지 공간 우선).
- 무대: 셸(flex 센터) 안 `aspect-ratio: 3/2 + width:100% + max-height:100%` — 남은 높이에
  3:2 유지 fit(선택지 예약 후 남는 공간). 이미지 `contain` 유지 — **crop 금지 원칙 그대로**,
  비율 다른 그림은 여백(흰 배경)으로 수납.
- 선택지 3행 예약 그리드(146px)는 FOLLOWUP-1 그대로 — 이제 같은 grid 행이라 밀림 불가.

## 3. 검증 (실 viewer.html · 사용자 조건 재현: 큰 표지+20장면+실 0000 AI 그림+선택지 2~3개)
- **PDF(A4) 21페이지 = N+1** · 페이지 높이 전부 **950px 고정**(1027 초과 0) · 빈 페이지 0.
- **선택지 전 장면 같은 페이지**(20/20) · 3개 칸 146px · 엔딩 동일.
- **AI 그림 crop 0 실증**: natural 1.5 = stage 1.5 = contain(계산 일치) + 스크린샷 육안 —
  실제 0000 AI 일러스트가 무대 전체에 온전히, 말풍선은 학생 좌표 그대로, 선택지 3개 하단 카드.
- afterprint/unclip 정리 · 타 print gate 충돌 0 · console error 0 · 테스트 462/462 ·
  원본 데이터 write 0 · AI 호출 0(실데이터 read만).

## 4. 남은 후속
- 실프린터 1회 · admin 실계정 ⋯ 인쇄 클릭 1회 · aiChecks rules 승인 대기.

## 버스터
`scenepubfix2` — pb-ai.css(viewer.html).
