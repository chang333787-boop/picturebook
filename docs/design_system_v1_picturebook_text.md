# DESIGN-SYSTEM-V1 — 그림책 5스킨 / 텍스트 8테마 (명세)

> 단일 출처 baseline: 메모리 `DESIGN-SYSTEM-V1_BASELINE_20260619`
> 기준 HEAD `1cb3278` · 이 문서는 **설계 명세**이며 앱 코드/CSS 변경 아님.
> 조사 근거: DESIGN-REBUILD-0 + ASSET-COMPONENT-0 (둘 다 read-only).

---

## 0. 설계 원칙 (전체 관통)
- **그림책**: 스킨은 그림을 "모시는" 매트·종이·분위기 담당. **학생 그림은 절대 가리거나 자르지 않음**. 장식은 가장자리·여백에만.
- **텍스트**: 에셋 최소. typography(위계)·spacing(여백)·background(카드↔배경 통일)·button tone 4가지로 PPT 느낌 제거.
- **공유 범위**: 표현 계층 + 상태 규칙만 공유. 스킨/테마 외형은 `data-pb-theme`(body) vs `data-text-theme`(scene) 셀렉터로 완전 분리.
- **토큰 우선**: 간격 8배수, 반지름 3단(sm/md/lg), 색은 스킨/테마별 CSS 변수(`--surface`, `--panel-bg`, `--ink`, `--btn-bg`, `--accent`, `--ornament`)로 주입 → 표현 계층은 변수만 소비.
- **기존 보존**: 캔버스 비율/가로세로/분할형/그림중심형/모바일 전환/저장/분기/nextId/AI 원본/maker·viewer·branch 왕복 = 절대 유지. React 전환·대형 리팩토링·외부 이미지·DB 구조 변경·기존 데이터 삭제 금지.

---

## 1. 공통 표현 계층
| 표현 단위 | 역할 | 그림책 | 텍스트 | 주의점 |
|---|---|---|---|---|
| **scene-surface** | 장면 배경·질감 캔버스 | `.scene-screen--pb`↔`.pb-page` 사이 한 겹 | `.text-page`↔`.text-card` 사이 | ⚠️ 그림책은 반드시 `.pb-page` **바깥**(screen↔page 레벨) — imageCenter 드래그 좌표(.pb-stage) 보호 |
| **scene-media-frame** | 그림 매트/테두리 | 기존 `.pb-illust` 매핑 | 없음 | 그림 `object-fit:contain` 보존, 프레임은 그림 **밖**에만 |
| **scene-narrative-panel** | 본문 패널 | `.pb-text`/`.pb-text__body` 래핑 | `.text-card` 본문 | flex:1 → `min-height:0` 필수 |
| **scene-choice-group** | 선택지 묶음 | `.pb-text__actions[data-count]` 래핑 | `.text-card__actions` 래핑 | data-count 보존, flex-shrink:0 |
| **scene-choice-button** | 선택지 1개 | `.choice-v03--picturebook` | `.choice-v03--text` | data-choice-id/nextId/aria-disabled 불변 |
| **scene-ornaments** | 장식 슬롯 | `.pb-frame` 앞/뒤 **빈 div 슬롯** | 거의 미사용 | ::before/::after 점유 테마 있음 → 빈 div 권장. `pointer-events:none` |
| **scene-ending-mark** | 엔딩/진엔딩 표식 | `.pb-ending-meta-inline` + `data-is-true-end` | `.text-ending-mark` | 시스템버튼(.terminal-btn)과 분리 유지 |

편집 바인딩(contenteditable `[data-pb-editable]`, 드래그 `.js-pb-body-overlay`, AI variant `[data-ai-variant-edit]`)은 `frame.querySelectorAll` 기반 → wrapper 한 겹은 DOM 깊이 무관(대체로 안전).

---

## 2. 그림책 5스킨 상세
| 스킨 (key) | page surface | illustration frame | caption panel | choice button | ornaments | ending mark | 필요 에셋 | 피해야 할 것 |
|---|---|---|---|---|---|---|---|---|
| **포근한 동화책** `cozy-storybook` | 따뜻한 크림 + 옅은 종이결 | 부드러운 둥근 매트, 은은한 안쪽 그림자 | 크림 본문 카드, 둥근, 따뜻한 잉크 | 둥근 알약형, 크림+세이지 hover, 번호 약화 | 모서리 잎/작은 꽃(옅게) | 둥근 리본/하트 옅게 | data-uri 잎·꽃, CSS 종이결 | 진한 테두리·강한 그림자 |
| **종이 동화책** `paper-storybook` | 오프화이트 + 거친 종이결 + 미색 비네팅 | 사각 매트 + deckle(찢긴) 가장자리 | 미색 종이 카드, 살짝 사각, 명조 본문 | 사각 약간, 종이톤, 잉크 테두리 1px | 종이 모서리 접힘 | 잉크 스탬프(원형 도장) | CSS deckle gradient/mask, 종이결 | 광택·네온·둥근 과다 |
| **전시 그림책** `gallery-picturebook` | 갤러리 화이트/연회색, 질감 거의 0 | 넓은 매트 여백(액자) + 가는 선 테두리 | 흰 카드, 절제된 sans, 넓은 행간 | 미니멀 아웃라인, 흑백, hover만 채움 | 거의 없음(여백이 장식) | 가는 선 + 작은 라벨 | 없음(여백·선만) | 색·장식 과다 |
| **숲속 그림책** `forest-storybook` | 세이지/모스 그린 + 옅은 잎 패턴 | 자연 매트, 나뭇결 톤 테두리 | 연녹 본문 카드, 갈색 잉크 | 잎맥 느낌, 그린 톤, 라운드 | 모서리 잎·가지·작은 새 | 잎 화환형 | data-uri 잎·가지·새, 그린 gradient | 채도 과다, 그림 가림 |
| **밤 이야기** `night-story` | 짙은 남색/인디고 + 별(radial) + 달(data-uri SVG) | 어두운 매트 + 부드러운 발광 테두리 | 어두운 반투명 패널, 밝은 잉크(대비 확보) | 어두운 알약, 별빛 hover | 별·달·구름(상단), 하단 비움 | 초승달 + 별 | 기존 night-tale 별/달 재활용 | 본문 대비 부족, 과한 blur |

**legacy 매핑 (DB·CSS 보존, UI 숨김·fallback)**: `classic-book→cozy`, `paper-desk→paper`, `minimal-cream→gallery`, `night-tale→night`, `sketch-note→paper`, `library-card→gallery`. legacy 값은 렌더 시 가장 가까운 신규 스킨으로 표시 fallback, 저장값 불변·삭제 금지.

---

## 3. 분할형 / 그림중심형 차이 (스킨 공통 규칙)
표현 계층은 동일, media-frame·caption·choice 배치만 레이아웃별로 분기. grid 비율·aspect는 변경 안 함.

| 항목 | 분할형 (split) | 그림중심형 (imageCenter) |
|---|---|---|
| 그림 프레임 | 그림 영역에 매트 테두리(여백 안쪽). 그림↔본문 물리 분리 | 풀블리드. 프레임=가장자리 비네팅만 |
| 캡션 위치 | 본문 패널 별도 영역(가로 하단 30%, 세로 하단 40%) | 그림 위 반투명 패널 오버레이(드래그 위치 유지) |
| 버튼 위치 | 본문 패널 하단(`.pb-text__actions`) | 화면 하단 20%(`.pb-text--bottom-only`) |
| 하단 스크림 | 불필요(본문 분리) | 필수(그림 위 가독성). 패널 반투명 + 하단 그라데이션 |
| 밝은/어두운 그림 가독성 | 본문 분리라 안정적 | 패널 불투명도 0.82~0.88 + 잉크 대비 토큰으로 보수적 고정(이미지 분석 X) |
| 긴 본문 | 패널 내부 스크롤, `min-height:0` | 오버레이 패널 내부 스크롤 + 최대 높이 제한 |
| 모바일 세로 | 60:40 보존, 버튼 풀폭 스택 | 오버레이 패널 폭 확대·하단 고정, 버튼 풀폭, 스크림 강화 |

---

## 4. 텍스트 8테마 상세
공통 PPT 제거: ① 배경·카드 한 테마 톤 통일 ② 버튼을 테마 톤 종속 ③ 위계(크기·여백 8배수) ④ 엔딩까지 동일 테마.

| 테마 | surface | text card | typography | choice button | ending / true ending | PPT 제거 포인트 |
|---|---|---|---|---|---|---|
| **classic** | 오프화이트 | 흰 카드, 옅은 테두리 | 산세, 명확한 위계 | 중립 회색, hover 채움 | 가는 선+라벨 / 진엔딩=강조+옅은 금색 | 배경·카드 미세 톤차 분리 |
| **novel** | 베이지/세피아 | 미색 카드 | 명조, 넉넉한 행간 | 세피아 톤, 잉크 테두리 | 장식선 / 진엔딩=세리프 강조 | 소설 지면 여백·행간 |
| **paperbook** | 종이 톤 + 종이결 | 종이 카드 | 명조, 작은 본문 | 종이톤, 사각 약간 | 도장형 / 진엔딩=원형 스탬프 | 종이 질감으로 평면성 제거 |
| **note** | 격자/줄지 | 줄노트 카드 | 손글씨 | 노트 톤, 손그림 테두리 | 메모형 / 진엔딩=별표 스티커 | 줄지로 메모지 일관 |
| **magazine** | 밝은 배경 + 강한 여백 | 좌측 컬러 바 | 굵은 헤드라인 + 본문 대비 | 각진, 컬러 액센트 | 큰 룰 / 진엔딩=대형 헤드 | 헤드/본문 대비 위계 |
| **handwriting** | 편지지 톤 | 편지 카드 | 펜, 큰 본문 | 손글씨, 둥근 | 서명형 / 진엔딩=리본 | 편지지 결, 카드 경계 약화 |
| **retro** | 어두운 + 픽셀 노이즈 | 어두운 카드, 네온 테두리 | 픽셀 | 픽셀 버튼, 발광 hover | 클리어형 / 진엔딩=8bit 트로피 | 다크+네온 일관 |
| **dark** | 짙은 중성 | 어두운 카드, 밝은 잉크 | 산세, 높은 대비 | 어두운 톤, 은은한 테두리 | 미니멀 라벨 / 진엔딩=발광 라벨 | 명도단계로 깊이 |

---

## 5. asset-light 에셋 목록
방식 우선순위: **CSS gradient(질감/배경) > data-uri SVG(고정 위치 도형) > 빈 div + ::pseudo(슬롯)**. 외부 PNG/WebP는 2차.

| 에셋 | 방식 | 사용처 |
|---|---|---|
| 꽃 | data-uri SVG | cozy/forest 모서리, 색 변수 적응 |
| 잎 | data-uri SVG | cozy/forest 가장자리 |
| 별 | CSS radial-gradient 다중 | night 배경, 모바일 감산 |
| 달 | data-uri SVG (night-tale 재활용) | night 상단 고정 |
| 구름 | data-uri SVG / radial | night/cozy 옅게 |
| 종이 질감 | CSS repeating-linear/radial gradient | paper/cozy/paperbook(텍스트) |
| 종이 가장자리(deckle) | CSS gradient + mask | paper media-frame. 어려우면 v1은 톤테두리로 단순화 |
| 숲 장식(가지·새) | data-uri SVG | forest 모서리 |
| 엔딩 마크 | data-uri SVG (스킨별 스탬프/초승달/리본) | scene-ending-mark, 진엔딩=별/금색 변형 |

data-uri/gradient는 로딩 실패 개념 없어 **fallback 불필요**. 모든 장식 `pointer-events:none`, 색은 변수 주입.

---

## 6. 1주 구현 우선순위
표현 계층 골격을 먼저 깔고, 스킨/테마는 그 위에 CSS만 얹기. 매 단계 실기기 1회 확인.

- **D1 — 표현 계층 골격**: scene-surface + scene-choice-group 래퍼 추가. 시각 변화 0, 거점 확보. 편집/드래그/AI variant 회귀 점검(최우선 안전 게이트).
- **D2 — 토큰 + 텍스트 8테마**: 에셋 적어 빠름. `data-text-theme` 하위 surface/card/button/ending 통일. PPT 제거 먼저 체감.
- **D3~D4 — 그림책 5스킨**: `data-pb-theme` 신규 5키 CSS. media-frame 매트·caption 패널·surface 배경. legacy 6키 보존+fallback. split/imageCenter 분기.
- **D5 — 엔딩/진엔딩**: scene-ending-mark 스킨/테마별, `data-is-true-end`. 시스템버튼 분리 유지.
- **D6 — ornaments + 에셋**: 빈 div 슬롯에 잎/별/달/꽃 주입. imageCenter 스크림·대비 보정.
- **D7 — 모바일/성능 + 회귀**: 세로 대응, night 별/그림자 모바일 감산, 긴 본문/긴 선택지/그림 없음/미연결 상태·legacy 작품 렌더 회귀.

---

## 7. 중단 조건
- wrapper가 편집 바인딩/grid 비율·aspect/좌표계(.pb-stage)를 깨야만 성립
- legacy pbTheme/textTheme DB 값 삭제가 필요해지는 설계
- 외부 이미지·대형 라이브러리·React가 필요해지는 방향
- 무비/체험전시 경로를 건드려야 하는 변경
- 선택지 4개+ legacy를 잘라야 표현이 성립
→ **즉시 중단**.

---

## 8. 다음 단계
이 명세를 Claude Design에 넘겨 컴포넌트별 실제 디자인 명세(픽셀/색값)를 받거나, 시각 목업으로 느낌 검증 후 D1부터 착수. 구현 착수 전 승인 필요.
