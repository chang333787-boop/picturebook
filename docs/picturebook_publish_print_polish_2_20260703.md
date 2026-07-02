# PICTUREBOOK-PUBLISH-PRINT-POLISH-2 — 지도 제거 + 출판형 품질 재수정

- 일자: 2026-07-03 · 기준: origin/main `dd48677` · client-only
- 판정: **PICTUREBOOK_PUBLISH_PRINT_POLISH_2_LIVE_PASS**

## 사용자 PDF에서 발견한 문제와 처리

### 1. 이야기 길 지도 제거 (제품 결정)
- 지도 페이지 생성 블록 삭제(picturebook-print.js) — 구조 점검 성격이라 학생 출판물과 안 맞음.
- **새 구성: 표지 1쪽 → 2쪽부터 장면당 1쪽. N장면 = N+1쪽(20장면=21쪽).**
- BFS 번호(buildPrintOrder)·`→ N번 장면으로 가세요`·엔딩·추가 장면 처리는 지도와 무관 — 무영향
  (order.test 8케이스 그대로 통과). 지도 CSS는 잔존(후속 '지도 별도 출력' 대비·무해).

### 2. 그림 누락 = print 버그 (데이터 문제 아님)
- 원인: `_publishedImage`가 `scene.imageData`만 봄. **viewer-render는 `imageData || imageUrl`**
  (587·1015·1587행) — v113 Storage 이전 작품은 그림이 `imageUrl`에만 있어 인쇄에서 전부 누락.
  (사용자 PDF에서 1번만 보였던 것도 그 장면만 base64 잔존이었기 때문으로 설명됨.)
- 수정: `imageData || imageUrl` fallback — 표지 포함. 검증: imageUrl-only 20장면 mock에서
  **19/19 이미지 출력**(무그림 1장 제외).

### 3. 그림 없는 장면 text-only 레이아웃
- 문제: 본문 위·선택지 맨 아래로 갈라져 가운데가 텅 빔(auto 마진 3분할).
- 수정: 본문+선택지를 한 묶음으로 중앙 배치 — 본문 `margin:auto 0 0`(15pt·줄간 1.9·중앙정렬),
  선택지/엔딩 `margin-top:26px + margin-bottom:auto`(구분선 제거·본문 바로 아래).
- 실측: 본문 시작 지점 페이지 46%(중앙)·본문↔선택지 26px·하단 여백 자연스러움.

### 4. Chrome 머리글/바닥글 안내
- 작품마무리 모달의 🖨 그림책 인쇄 버튼 아래 작은 안내 추가:
  "💡 깔끔한 그림책으로 출력하려면 인쇄 창의 '설정 더보기'에서 **머리글과 바닥글**을 꺼 주세요."
  + 버튼 title에도 병기. 모달 요소라 **출력물에는 인쇄되지 않음**(print root에 미포함 검증).
  alert/모달 추가 없음.

## PDF 검증 (실 viewer.html + 전체 CSS — standalone 아님)
- A4 세로 **DOM·PDF 모두 21쪽**(표지1+장면20) · 1쪽=표지 · 2쪽=1번 장면 · 지도 페이지 0.
- imageUrl 장면 이미지 출력 19/19 · 무그림 장면 중앙 배치 · 선택지 "▸ 간다. → 2번 장면으로 가세요" ·
  엔딩 "— 이야기 끝 —" · print-doc-unclip 부여/정리 · afterprint cleanup · 타 print gate 충돌 0 ·
  console error 0.
- 테스트 462/462(rules 제외 기존 동일) · node --check OK.

## 남은 후속
- 이야기 길 지도 별도 출력(수요 시) · AI 장면발전 인쇄 옵션 · **교사 PC 실프린터 1회**
  (imageUrl=Storage 원격 이미지 다수 작품의 로드 대기 실측 포함 — 인쇄 미리보기에서 이미지가
  다 뜬 뒤 인쇄 권장).

## 버스터
`publishprint2` — picturebook-print.js·pb-ai.css·viewer-ai.js(AI_SRC).
