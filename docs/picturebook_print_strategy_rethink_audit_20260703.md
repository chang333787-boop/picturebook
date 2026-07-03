# PICTUREBOOK-PRINT-STRATEGY-RETHINK-AUDIT — 교사용 그림책 출판 인쇄 재설계

- 일자: 2026-07-03 · 기준: origin/main `81d9acb` · read-only 감사(코드 수정 0·DB 0·deploy 0·AI 0)
- 판정: **PICTUREBOOK_PRINT_STRATEGY_READY_FOR_SCENE_CAPTURE**
  (단, 로드맵 1단계는 PRINT-ROLE-GATE — 아래 §6)

## 1. 현재 방식의 문제와 새 판단
현재 출판형(LAYOUT-4/OPTIONS-1)은 그림·본문·선택지를 인쇄용으로 **재배치** — 안정적이지만
학생이 그림 위에 배치한 **말풍선 위치·크기·진하기·장면 구성**이 사라져 "작품"이 아니라
"자료"처럼 보인다. 새 원칙: 화면의 그림중심형 장면 자체를 크게 출력(선택지만 하단 정리),
인쇄는 학생 태블릿이 아니라 **교사 컴퓨터/관리 흐름**의 기능.

## 2. 현재 인쇄 버튼 위치 (§1 조사)
- `🖨 그림책 인쇄`는 작품마무리 모달(secRoute) — 조건 `isEditViewerSession && picturebook`.
  **학생 다듬기 세션에도 노출**(교사/학생 구분 없음).
- viewer에는 교사 판정 수단이 없음(익명 세션·grep: teacher 판정 0건).
  근사 수단 존재: **admin 대시보드 → 팀 카드 → 감상 보기**가 `branchReturnContext.source='admin'`
  을 localStorage에 남기고 viewer로 진입(adminConsole.js:1183-1193) → viewer가 이 마커로
  "교사(관리) 진입"을 UI 노출용으로 판정 가능(보안 아님·노출 게이트로는 충분).
- admin(?admin=1·teacher/super_admin 인증)에는 팀 목록 카드+상세가 이미 있어
  작품별 [🖨 인쇄] 버튼을 추가할 자리가 자연스럽다.

## 3. 장면 렌더 구조 (§2 조사) — "장면 그대로 인쇄"의 재료
- imageCenter 마크업(viewer-render.js:783-796): `.pb-page(단일 비율 캔버스) > .pb-frame >`
  **`.pb-stage`(그림 + 제목 오버레이 + 말풍선)** 와 **선택지(.pb-text--bottom-only)가 형제로 분리**.
  → 무대만 재현하고 선택지를 하단 정리하는 구성이 DOM 구조상 이미 나뉘어 있다.
- 말풍선 = `.pb-stage__body-overlay` inline style — **% 좌표**(left/top/width%, height %|auto,
  `--pb-box-opacity`+background 진하기). 저장 = `scene.picturebookBodyBox{x,y,width,height,backdropOpacity}`(%).
  제목도 오버레이. **% 기준이므로 인쇄 전용 고정 무대에서 그대로 재현 가능.**
- AI 토글: 글 = `_getDisplayBody`(s2 body) + variant layout(`aiVariants/text/{sid}/s2/layout`·
  opacity는 원본 따름), 그림 = `_getDisplayImageSrc`(s2 url). OPTIONS-1의 `getS2Body/getS2Image`
  콜백 패턴을 그대로 쓰면 원본/AI 4조합이 장면 재현 방식에도 이식된다.
- 무대 비율: 감상 가로 = **3:2**(v03-modes.css:289), 편집 = A4가로(297/210), 컨테이너 쿼리
  contain-fit. 그림은 contain(크롭 0).
- ⚠️ 일부 텍스트가 **cqh/cqw(컨테이너 비례) 폰트**(v03-modes.css:2087~) — 화면 크기에 따라
  글자 크기·줄바꿈이 달라질 수 있음 = 사용자가 걱정한 "해상도에 따라 말풍선이 달라지는 문제"의 실체.

## 4. 인쇄 방식 비교 (§3)
| | 장점 | 단점 | 난이도 | 해상도 위험 | 작품 보존성 |
|---|---|---|---|---|---|
| A. 재배치형(현행) | 안정·가독·이미 완성 | 말풍선/구성 소실 | 0(완료) | 없음 | 낮음 |
| B. 장면 캡처형(전체 그대로) | 작품 느낌 최대 | 선택지 버튼까지 화면형 그대로면 인쇄물로 어색·터치 UI 잔재 | 중 | 고정무대로 해결 | 최고 |
| **C. 혼합형(추천 ★)** | **무대(그림+말풍선) 그대로 크게 + 선택지만 하단 인쇄용 정리** — 작품 보존+출판 가독 양립 | 무대 재현 CSS 신규 필요 | 중 | 고정무대로 해결 | 최고 |
| D. 옵션형(그대로/재배치 선택) | 유연 | UI 복잡·유지 2벌 | 중상 | 동일 | - |
- **C안 추천**: DOM이 이미 무대/선택지로 분리돼 있고, "캡처(래스터화)"가 아니라 **인쇄 전용
  고정 무대에 동일 마크업+% 좌표를 재적용하는 DOM 재구성**으로 충분 — canvas/스크린샷 불필요,
  이미지 화질 손실 0. 기존 재배치형 코드는 D안 대비용으로 보존 가능(당장은 C로 교체 권장).
- 표지/무그림 장면은 현행 출판형 디자인(DESIGN-3) 재사용.

## 5. 해상도 문제 해결 설계 (§4)
**인쇄 전용 고정 무대** — 숨김 print root 안에 기기 화면과 무관한 고정 픽셀 무대를 만든다:
```
.pbp-scene-stage { position:relative; width:1200px; height:800px; }   /* 3:2 — 감상 정본 비율 */
  ├ img: absolute inset 0, object-fit:contain (감상과 동일·크롭 0)
  ├ 제목 오버레이: 감상과 동일 클래스/규칙 복제(고정 px 폰트)
  └ 말풍선: left/top/width/height % 그대로 + backdropOpacity + 폰트 px 고정(예: 22px)
```
- % 좌표 ↔ 고정 무대라 **태블릿/PC/창 크기와 무관하게 항상 같은 출력**(결정적).
- cqh/cqw 가변 폰트는 인쇄 무대에서 px로 고정 — 줄바꿈까지 재현 일관.
- A4 세로 배치: 무대 1200×800을 페이지 폭(≈718px)에 `transform: scale(0.598)` 또는
  width 100%+aspect-ratio 3/2 박스로 fit → 높이 ≈479px. 아래 본문 없음(말풍선이 본문),
  하단 선택지 박스(현행 `▸ … → N번 장면으로 가세요` 재사용). 페이지당 1장면 유지·N+1쪽.
- 말풍선이 무대 밖으로 못 나가는 건 저장 시 클램프(기존 편집 12~90% 클램프)가 이미 보장.
  variant layout도 동일 % 체계.
- 검증법: 두 가지 뷰포트(예: 800×600, 1920×1080)에서 인쇄 DOM 좌표가 byte-identical함을 실측.

## 6. 교사용 인쇄 진입 설계 (§5)
- **추천 조합 = B + C**:
  - **B**: 작품마무리의 인쇄 버튼을 admin 진입 마커(`branchReturnContext.source==='admin'`)가
    있을 때만 노출(학생 다듬기 세션에선 숨김). client-only·저위험. ※ localStorage 마커라
    보안 게이트는 아니고 "학생 화면 단순화" 목적 — 인쇄 자체는 위험 동작이 아니므로 충분.
  - **C**: admin 팀 카드 상세에 [🖨 그림책 인쇄] 추가 — `감상 보기`와 같은 viewer 진입 후
    자동으로 인쇄 옵션 모달을 여는 쿼리(예: `&print=pb`) 1개. 기존 복귀 컨텍스트 재사용.
- A(교사 세션에서만 표시)는 viewer에 교사 판정이 없어 단독 불가, D(문구만 교사용)는 미봉책.

## 7. 추천 로드맵 (§6)
1. **PRINT-ROLE-GATE-1** — 인쇄 버튼 학생 숨김(admin 마커 게이트) + admin 카드 [🖨 인쇄]
   진입(&print=pb). client-only·위험 낮음. 확인: 학생 다듬기에 버튼 없음/AI admin 경유 노출.
2. **PICTUREBOOK-SCENE-CAPTURE-PRINT-1** — C안 구현: 고정 무대(1200×800·%좌표·px폰트) 재현
   + 하단 선택지 + 표지/무그림 현행 재사용. client-only·중간. 검증: 두 뷰포트 좌표 동일성·
   실 viewer.html PDF·말풍선 진하기/위치 육안.
3. **PICTUREBOOK-SCENE-CAPTURE-PRINT-2** — OPTIONS-1 콜백을 무대 재현에 연결(원본/AI 글·그림
   4조합 + variant layout 반영). client-only·낮음.
4. **ADMIN-PRINT-ENTRY-1** — (1에 통합 가능) admin 목록 인쇄 진입 마감·복귀 흐름 확인.
- 전 단계 client-only 가능 · 원본 데이터 write 0 · Functions/Rules 무관.

## 8. 다음 구현 명령 제안
`PRINT-ROLE-GATE-1`(빠른 1단계) → `PICTUREBOOK-SCENE-CAPTURE-PRINT-1`(본체).
둘을 한 루프로 묶어도 규모 무리 없음(게이트가 소규모).
