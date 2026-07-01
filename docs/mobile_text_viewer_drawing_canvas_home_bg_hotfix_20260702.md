# 모바일 홈 배경 + 텍스트 감상 + 직접 그리기 캔버스 hotfix/조사

- 일자: 2026-07-02
- 성격: 클라 CSS hotfix(§1·§2~4) + read-only 조사(§5~7) · deploy 0 · 실 AI 0 · DB write 0 · rules/functions 무변경
- 판정: **`MOBILE_HOME_TEXT_DRAWING_HOTFIX_LIVE_PASS`** (§1·§2~4 수정·검증·병합 / §7 `DRAWING_TO_IMAGES2_ALREADY_WORKS` / §5~6 캔버스는 크롭 없음·수정 보류)

## §1 메인 첫 화면 모바일 흰색 배경
- **원인**: index.html은 tokens-warm.css/warm-screens.css를 쓰는데 **html/body에 배경/margin 리셋이 없음** → 기본 흰색 + body margin 8px 노출. 토큰(`--paper`)은 `.v` 래퍼에만 정의돼 html/body에서 `var(--paper)` 접근 불가. `.v`도 동적 뷰포트를 못 채워 하단(Safari 주소창 아래) 흰색.
- **수정**(index.html 인라인 `<style>`·홈만 스코프): `html, body { margin:0; padding:0; background:#fbf6ea; }`(=--paper 리터럴) + `body, .v { min-height:100vh; min-height:100dvh; }`.
- **검증**(Playwright, 모바일 폭): htmlBg/bodyBg = `rgb(251,246,234)`(#fbf6ea) · body margin `0px` · `.v` min-height `100dvh`로 뷰포트 가득(vFills=true) · 콘솔 favicon만. 데스크톱 무영향(배경/리셋은 전 화면 공통이나 시각 동일).

## §2~4 모바일 텍스트 감상(표지/본문/행동버튼)
- **원인**: 실제 레이아웃 `.scene-screen--text-paged > .text-page > .text-card`(viewer.css:6631~)에서 `.text-page`가 **`aspect-ratio:210/297`(세로) 고정**. 세로로 긴 폰에선 페이지가 화면보다 짧아 **상하 여백 크게 낭비**, 표지도 그 비율 안에 갇혀 어색. (데스크톱/태블릿은 이 고정이 크로스디바이스 일관성 목적으로 적절.)
- **수정**(viewer.css·`@media (max-width:600px)`만): `.scene-screen--text-paged` padding 12→8px · `.text-page { aspect-ratio:auto; width:100%; height:100%; max-height:100% }`(비율 고정 해제·화면 채움) · `.text-card` padding `16px 16px 14px`(모바일 축소). 데스크톱/태블릿(>600px) 기존 고정 유지.
- 본문 스크롤/행동버튼 하단 고정은 기존 규칙이 담당: `.text-card__body { min-height:0; overflow-y:auto }`(v03-modes.css HOTFIX-LAYOUT) + `.text-card__actions { flex-shrink:0 }` + `.text-card { overflow-y:auto }`.
- **검증**(Playwright 합성·viewer.css+v03-modes.css 둘 다 로드·≤600px): 페이지 `aspect-ratio:auto`·프레임 높이 가득(FILLS) · 긴 본문 `bodyScrolls=true`(min-height 0·overflow-y auto) · 행동버튼 `actionsInsideCard`+`actionsWithinFrame`=true(카드 하단·프레임 내). ⚠️1차 합성이 v03-modes.css 미로드로 오탐→둘 다 로드 후 PASS.

## §5~6 직접 그리기 캔버스 비율 (조사 — 수정 보류)
- 캔버스(viewer-edit.js `_openPbDrawModal`)는 진입 시 활성 scene의 `.pb-illust` 슬롯을 실측해 비율을 맞춤(canvasW=1200·submode별 imageCenter≈1.414/split≈2.376). 저장은 `toDataURL('image/jpeg')` 그대로(스키마 변경 없음).
- 감상 표시(`_setupPbPhotoWrappers`)는 자연비율 **contain(레터박스)** — **크롭/늘어남 없음**(학생 그림 잘림 방지 원칙). 편집 프레임(A4 1.414)↔감상(3:2 1.5) 차이로 **여백만** 생길 수 있으나 잘림 아님.
- **수정 보류**: 크롭 버그가 없고, 캔버스 진입 비율을 감상 정본에 고정하는 변경은 submode(split vs imageCenter) 슬롯 비율 차이 때문에 오히려 회귀 위험. cover 전환은 전 작품 그림 잘림 유발이라 금지. → 이번 hotfix 범위 밖, 필요 시 다음 설계 루프.

## §7 직접 그리기 → AI 그림책 마감(imageS2) — `DRAWING_TO_IMAGES2_ALREADY_WORKS`
- 직접 그리기 결과는 v114부터 base64가 아니라 **Firebase Storage 업로드 URL을 `scene.imageData`에 저장**(업로드와 공용 `viewerUploadImageToStorage`).
- imageS2(callImageAiS2→image-s2-generation)는 클라가 `sceneId`만 보내고 서버가 `scene.imageData || scene.imageUrl`을 소스로 읽음. Storage 호스트가 SSRF allowlist에 포함 → **직접 그리기·업로드 완전 동일 경로**로 처리. 클라/functions 수정 불필요.
- (참고) 빈 캔버스도 흰 이미지로 저장돼 quota 소모 가능 — 클라 가드 없음(개선 후보·이번 미수정).

## 검증 요약
- 콘솔 에러 0(favicon만). 실 AI 0 · DB write 0 · Functions/Rules deploy 0.
- 변경 파일: index.html(인라인 style)·viewer.css(모바일 @media)·viewer.html(viewer.css 캐시버스터 `mobiletextdrawfix1`).
- ⚠️ NOT_VERIFIED(실기기 시각): 실제 텍스트 작품 표지/본문·실 그림책 그리기의 픽셀 시각은 실작품+세션 필요(합성/CSS 단위 검증 완료). 스샷 mobile-home-bg-hotfix.png.

## 남은 것
- §5~6 직접 그리기 캔버스 비율 정본화(설계 루프·submode별 여백 최소화·크롭 금지 유지).
- 빈 캔버스 가드(선택).
- 실기기 텍스트 감상/그리기 시각 확인.
