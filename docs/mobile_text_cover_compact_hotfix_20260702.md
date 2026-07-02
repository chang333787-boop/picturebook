# 모바일 텍스트 표지 compact hotfix

- 일자: 2026-07-02
- 성격: 클라 CSS hotfix(viewer.css·표지만) · deploy 0 · 실 AI 0 · DB 0 · rules/functions 무변경
- 판정: **`MOBILE_TEXT_COVER_COMPACT_LIVE_PASS`**

## 1. 원인
텍스트 작품 표지는 본문(`scene-screen--text-paged`)과 **다른 구조** — `renderCover()`가 그림 없는 표지를 `scene-screen--pb pb--split cover-as-pb cover-as-pb--text` + `.pb-page > .cover-book`(`grid-template-rows: 1fr 2fr 1fr`)로 렌더(viewer-render.js:233~). 모바일에서 `.pb-page`가 화면을 채워 커지면 **1fr:2fr:1fr 그리드가 제목/장식/시작버튼을 페이지 전체로 stretch** → "큰 빈 박스"처럼 보임. 지난 본문 compact 규칙(`scene-screen--text-paged`)은 이 표지에 적용되지 않았음.

## 2. 수정 파일 / 3. 스코프
`viewer.css` `@media (max-width:600px)`에 **`.cover-as-pb--text`(텍스트 표지 전용) 스코프**로 추가:
```css
.cover-as-pb--text .pb-page { justify-content: center; }
.cover-as-pb--text .cover-book {
  flex: 0 1 auto; height: auto; min-height: 0; max-height: 100%;
  grid-template-rows: auto auto auto;   /* fr stretch → 콘텐츠 기반 */
  align-content: center; gap: clamp(10px,2dvh,18px);
  padding: clamp(20px,5vw,32px) clamp(18px,5vw,32px);
}
.cover-as-pb--text .cover-book__center { gap: clamp(8px,1.5dvh,14px); }
.cover-as-pb--text .cover-book__bottom { padding-top: clamp(10px,2dvh,16px); }
```
- **스코프 안전 확정**: 렌더상 이미지 표지 = `cover-as-pb`(‑‑text 없음), 일반 그림책 장면 = `cover-as-pb` 자체 없음. `.cover-as-pb--text`는 **텍스트 표지에만** 붙음(viewer-render.js:208 vs 234). 데스크톱/태블릿(>600px) 기존 book-cover 유지.

## 4. 표지 compact 개선 (before/after 수치)
Playwright에서 **pb-page를 실기기 '꽉 참'처럼 700px 강제**해 기전 비교(390px 폭):
| | 대조군(이미지표지·1fr:2fr:1fr) | 수정(텍스트표지·auto+center) |
|---|---|---|
| cover-book 높이 | 698px(페이지 stretch) | **368px**(콘텐츠 기반) |
| 제목↔시작버튼 gap | **273px**(빈 박스 spread) | **113px**(compact·58%↓) |
| 시작버튼 표시/뷰포트 내 | ✓ | ✓ |
→ pb-page가 클수록(실제 문제 상황) 개선 폭 큼. 자연 렌더(pb-page 짧음)에선 차이 작음(스크린샷 timing 무관).

## 5. 본문 compact 회귀 없음
`.cover-as-pb--text` 스코프라 `scene-screen--text-paged`(본문) 규칙과 독립 → 본문 compact(`mobiletextcompact1`) 무영향.

## 6. 그림책 표지 영향 없음
동일 700px 대조군에서 이미지 표지(`cover-as-pb`·‑‑text 없음)는 규칙 미적용 확인(698/273 그대로). 일반 그림책 장면 무영향.

## 7. 전환 잔상
이전과 동일 — `_stageReplaceScene`의 is-leaving fade 타이밍 아티팩트(DOM 중복 아님). 이번 표지 compact는 CSS만이라 전환 로직 무변경.

## 8~9. 검증
Playwright 390×844: 표지 compact 수치·시작버튼 클릭영역 보존·콘솔 0. 스샷 mobile-text-cover-compact.png.
- 변경: viewer.css(표지 모바일 블록)·viewer.html(캐시버스터 `mobiletextcover1`). functions/rules/DB/AI 무관.
- ⚠️ NOT_VERIFIED(실기기 픽셀): 실 작품 표지는 실기기 확인 권장(합성으로 기전·수치 확인 완료). 합성 pb-page 높이는 실 stage 컨텍스트(container query) 의존이라 700px 강제로 기전 검증함.

## 남은 것
- 실기기에서 텍스트 표지·본문 compact 최종 확인.
