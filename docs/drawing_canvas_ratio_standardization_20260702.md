# 직접 그리기 캔버스 비율 정본화 (DRAWING-CANVAS-RATIO)

2026-07-02 · 클라이언트 전용 · `viewer-edit.js` + `viewer.html` 캐시버스터
기준: `origin/main 74df0f6`(글로벌 효과 통일) 이후.

## 1. 배경 / 전제 검증
전제(작업지시)는 "직접 그리기 캔버스가 A4/세로 느낌"이었으나 **실측 결과 이미 가로**였다.
`viewer-edit.js:_openPbDrawModal`(≈7095)은 이미 활성 scene의 `.pb-illust` 박스를
`getBoundingClientRect`로 측정해 캔버스 비율을 동적으로 만든다(v36 설계). "A4 세로"는 stale.

## 2. 실측 (Playwright · 실제 viewer.css + v03-modes.css)
imageCenter `.pb-illust` 박스 비율:

| 컨텍스트 | page 비율 | illust 박스 비율 |
|---|---|---|
| 캔버스 생성(**편집모드**, A4 297:210) | 1.414 | **1.803** ← 여기서 측정됨 |
| 데스크톱/태블릿 **감상**(3:2, VIEWER-PLAY-ASPECT-1A) | 1.5 | **1.914** |
| 모바일 세로 감상 | 세로 | 훨씬 세로(상하 여백) |
| 측정 실패 fallback(구) | — | 1200×505 = 2.376 |

## 3. 여백의 진짜 원인 (2층)
1. **편집↔감상 컨텍스트 불일치**(개선 가능): 캔버스는 편집모드 A4(1.803)로 측정되는데
   감상은 3:2(1.914) → 주 감상 화면에서 **~6% 좌우 여백**. `VIEWER-PLAY-ASPECT-1A`(3:2)가
   감상 모드에만 적용되므로 편집 측정값은 구조적으로 감상과 못 맞는다.
2. **반응형 프레임 + contain**(제거 불가): imageCenter는 `background-size: contain`(크롭 금지 =
   핵심 원칙, v03-modes.css:393). 뷰포트별로 프레임 비율이 달라(편집 1.414 / 데스크톱 1.5 /
   모바일 세로 0.707) 어떤 단일 캔버스 비율로도 모든 뷰포트 여백 동시 제거는 불가능.

## 4. 결정 / 수정안
사용자 결정: **가로 감상 기준 표준화**. 캔버스를 편집 A4 박스가 아니라
주 감상(가로 3:2) 그림 박스 비율(≈1.914)로 재보정.

`illust 박스 비율 ∝ page 비율`(stage는 8fr row로 page 높이의 고정 비율)이라,
측정한 illust 비율을 감상 표준 page 비율(3:2)로 선형 재보정:

```
ratio = measuredIllustRatio * (1.5 / measuredPageRatio)
```

- 세로 작품(`body[data-page-orientation="portrait"]`): 감상도 세로 → **재보정 no-op**(회귀 없음).
- split: 감상이 `cover`(꽉 채움·크롭)라 재보정 시 크롭 증가 위험 → **현 측정 유지**.
- fallback도 imageCenter는 627(≈1.914), split은 505(기존)로 분리.

**좌표 안전성**: `_pos()`가 `canvas.width/rect.width` 스케일링(7401) → 내부 해상도 변경해도
좌표·브러시 정상. **신규 캔버스만** 적용 → 기존 imageData/그림 **무변환**(마이그레이션 없음).

## 5. 검증 (Playwright 1280×800)
| 케이스 | 측정 illust | 새 캔버스 target | 감상 illust | 결과 |
|---|---|---|---|---|
| 편집 landscape | 1.803 | **1.914** | 1.914 | 좌우 여백 0 |
| 세로 작품 | 0.887 | 0.887(no-op) | — | 회귀 없음 |

- `node --check viewer-edit.js` OK
- 변경 파일: `viewer-edit.js`, `viewer.html`(EDIT_SRC `...globaleffects1drawingratio1`)
- functions/rules diff 0 · 비밀키 0
- imageS2 입력 경로: 저장 소스(`scene.imageData`) 무변경 → **DRAWING_TO_IMAGES2_STILL_WORKS**

## 6. 남은 위험 / 후속
- 모바일 세로 감상 여백은 구조적(contain·크롭금지)이라 잔존 — 정상.
- 근본 해결(프레임을 그림 실비율에 맞춤)은 pb-stage/감상 렌더링 대변경이라 별도 설계 필요.
- 후속 후보(기록만): 빈 캔버스 imageS2 호출 방지.

## 7. 판정
**DRAWING_CANVAS_RATIO_LIVE_PASS**(구현·병합·live 예정) — 편집↔감상 불일치 해소,
세로/split 회귀 없음, imageS2 경로 유지.
