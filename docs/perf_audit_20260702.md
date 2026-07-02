# 가지 성능/렉 병목 전수조사 (PERF-AUDIT-1)

2026-07-02 · read-only(코드 무수정·AI 0·DB 0) · main HEAD `11e98a5`
범위: 태블릿/PC 그림책 + 모바일 텍스트 감상. **모바일 그림책 최적화 제외**(사용자 결정).
측정 환경: 데스크톱 헤드리스 Chromium 하니스(실 sceneRenderer/viewer-edit 로드) — 저사양 태블릿은
보수적으로 ×5~10 가정. 실기기(iPad) 수치는 미측정(한계 명시).

## 0. 전체 판정 요약
**수업 기준(10~17장면) 병목 없음.** 실측 전부 밀리초 단위·구조적 가드(지연로드·lazy 이미지·
에코 재렌더 스킵) 이미 존재. 남은 위험은 ①undo 메모리(~87MB·실기기 확인) ②legacy base64
작품(있다면) ③CSS 초기 파싱량 — 전부 Medium 이하.

## 1. 파일/번들 (지연로드 구조 유지 확인)
| 구분 | 크기 | 초기 로드? |
|---|---|---|
| viewer-edit.js 389KB + viewer-ai.js 253KB | 642KB | **지연**(PERF-2 유지 — 편집 진입 시만) ✅ |
| viewer 초기 JS(state/data/render/entry/locks/controls/image-batch×2) | ≈310KB | 초기 |
| CSS 합(viewer 265+v03 334+pb-ai 36+pb-tone 29) | **664KB** | 초기 — 파싱 비용 Medium·Low(캐시 후 무시) |
| maker.html 152KB + 스크립트 31개 | — | maker는 제작 화면이라 허용 범위 |
- 캐시버스터 체계 일관(전 파일 ?v=·viewer.html은 no-store 메타+SW로 구버전 혼합 방어) ✅
- 그림책 전용 기능(imageS2 batch 2파일 ≈소형)이 텍스트 감상에도 로드되나 합계 미미 — Low.

## 2. 브랜치 렌더 — **실측 비병목**
renderAll = 전체 카드 remove→재생성+drawArrows 구조이나:
| 카드 수 | renderAll 평균 | 비고 |
|---|---|---|
| 10 / 17 / 30 / 40 | **1.0 / 1.7 / 2.2 / 2.7ms** | drawArrows(30장) 0.2ms |
- 태블릿 ×10 가정에도 40장 ≈27ms — 문제 없음(legacy 30+장 작품도 안전).
- Firebase 에코 재렌더는 **편집 포커스 중·pan/drag 중 스킵 가드**(v118) 존재 ✅.
- 카드 썸네일: 원본(Storage URL) 사용이지만 `loading="lazy" decoding="async"` ✅ — 별도 썸네일
  없음은 Low(뷰포트 내만 디코드). 드래그 루프 내 console/heavy query 없음(sceneRenderer console 0).

## 3. 이미지/base64
- 직접 그리기 저장 = jpeg 0.85·1200px → 통상 수십~200KB Storage(RTDB 미저장, v114+) ✅.
- viewer 로드: scenes+viewer-meta+aiVariants 4노드 once — 필요분만. **위험은 legacy(v113 이전)
  base64 잔존 작품의 scenes read** — 신규엔 없음, 존재 시 해당 작품만 느림(Medium·관측).
- 감상 이미지는 장면 진입 시 렌더(일괄 preload 없음)·video는 preload=metadata ✅.
- imageS2 결과: 서버 고정 파이프라인(gpt-image-2 medium) — 크기 폭주 경로 없음.

## 4. 직접 그리기 — 실측
| 항목 | 실측 | 판정 |
|---|---|---|
| 모달 open | 7.9ms | 유지 |
| toDataURL(빈) | 5ms(내용 많아도 수십ms 급) | 유지 |
| 빈 캔버스 스캔(150×100) | **0.7ms/회** | 유지 |
| undo 스냅샷 1회 | 6.1ms·**2.9MB**(1200×627) | 유지 |
| undo 메모리 상한 | 통상 30개≈**87MB**(새 스트로크가 future 리셋·undo 연타 시 이론 최대 ~174MB) | **Medium — iPad 실측 필요**(기존 항목) |
- pointermove: quadratic 보간·로그 0·과도 연산 없음. 저장 busy/복구는 STUDIO-2에서 완비.

## 5. viewer 감상
- 장면 전환 = stage.innerHTML 교체(자식 리스너 자동 해제) + CSS 애니메이션(GPU 친화 fade/slide) —
  저사양에서 duration만 길게 느껴질 수 있음(설정으로 조절 가능) Low.
- 효과 전역 통일(globaleffects1) 이후 장면별 분기 계산 제거 상태 ✅.
- 모바일 텍스트 감상: 최근 핫픽스 전부 CSS-only(고정 프레임·compact) — JS 렉 요소 없음,
  requestAnimationFrame 1곳(토스트) 뿐 ✅.

## 6. RTDB
- maker: dbRef.on('value')로 scenes 구독(팀 단위 정상 패턴)·viewer-meta/locks/connected 구독 —
  화면당 고정 개수, 중복 등록 경로 없음. 나침반/마무리 데이터는 진입 시 once(상시 구독 아님) ✅.
- 저장: _queueSave 장면 단위 update(루트 set 없음) ✅. 여러 팀 동시 사용은 팀별 경로 분리라 상호 영향 없음.
- admin 팀 목록은 60초 캐시(기존) — "전 팀 scenes eager read"는 admin 전용 기존 항목(교사 1인 화면·수업 렉과 무관, 백로그 유지).

## 7. 리스너/메모리 누수
- draw modal: keydown/resize **제거 확인**(_close) ✅. heartbeat setInterval은 clearInterval 짝 존재(locks/viewer-locks/viewer-ai) ✅.
- 감상 장면 전환 innerHTML 교체 = 리스너 누적 없음. MutationObserver/ResizeObserver 미사용 수준.
- 장시간 수업(40분) 사용 시 누수 의심 경로 미발견 — 단 draw modal 반복 open은 히스토리 GC 의존(모달 remove 시 state 참조 해제 ✅).

## 8. console/log
렌더·드래그 루프 내 로그 0(sceneRenderer 0·viewer-render 5·viewer-data 3 — 전부 오류/1회성). 조치 불요.

## 9. 위험도 분류
- **Critical: 0** · **High: 0**
- **Medium**: ①undo 메모리 87MB(iPad 실측) ②legacy base64 작품 로드(존재 시 해당 작품 한정) ③CSS 초기 664KB 파싱(첫 방문 한정)
- **Low**: 카드 썸네일 원본 사용·imageS2 batch 파일 텍스트 감상 로드·전환 duration 체감

## 10. 다음 최적화 추천 — **E안(보류) + 실기기 측정**
- **E안 채택**: 10~17장 수업 기준 실측 병목 없음. A(로그/리스너)는 조치 대상 자체가 없고,
  B(썸네일)·C(렌더 캐시)는 실측상 근거 부족 — 선제 최적화는 회귀 위험만 추가.
- 유일한 실행 항목 = **수업 iPad에서 1회 관측**(그리기 undo 연속 사용 시 메모리/버벅임·legacy
  작품 있으면 로드 시간). 문제 발견 시에만 D안(undo 정책: 상한 30→15 또는 축소 저장) 진행.

## 최종 판정
**PERF_READY_NO_IMMEDIATE_ACTION** (+ 수업 iPad 관측 1회 권고) — 수업 투입에 성능상 차단 요소 없음.
