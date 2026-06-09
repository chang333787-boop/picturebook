# P5 이미지 AI 설계 기준

> 본 문서는 **구현 전 고정 기준**이다. P5 이미지 AI를 구현하는 모든 단계는 이 문서의 금지·보호 원칙을 위반하지 않아야 한다.
> 근거: P5-IMAGE-AUDIT-1 / P5-IMAGE-AUDIT-1B read-only 조사 결과(2026-06, HEAD `1b0f880` 기준).
> 이 문서 자체는 설계 문서이며, 어떤 코드도 구현하지 않는다.

---

## 1. P5 목표

이미지 AI는 **"새 그림 생성"이 아니라 학생 그림/업로드 이미지 정돈**이다.

**목표**
- 선 정돈
- 색 정리
- 밝기 보정
- 여백 정리
- 원본 구도 유지
- 원본 캐릭터 유지
- 원본 핵심 사물 유지
- 원본 위치 관계 유지
- 손그림 느낌 유지

**금지**
- 새 캐릭터 추가
- 새 사건 추가
- 새 핵심 사물 추가
- 새 배경 창작
- 구도 변경
- 캐릭터 위치 변경
- 핵심 의미 변경
- 과한 동화풍 변환
- 실사화
- 원본 작품 분위기 변경

이미지 1단계(imageS1)는 "정돈"만이다. 그림책풍/실사풍 변환(imageS2)은 P6 이후 별도 단계로 미룬다.

---

## 2. 절대 보호 원칙 (최우선)

원본 보호는 **RTDB 필드뿐 아니라 Storage 객체까지** 포함한다.

**절대 금지**
- `scene.imageData`에 AI 결과 저장 금지
- `scene.imageUrl`에 AI 결과 저장 금지
- 기존 `viewerUploadImageToStorage()` 경로 재사용 금지
- 기존 `images/{classId}/{team}/scene_{N}.{ext}` 경로 재사용 금지
- 원본 Storage 객체 덮어쓰기 금지
- 원본 이미지 삭제 금지
- 기존 업로드/그리기/삭제 helper를 AI 결과 저장에 그대로 재사용 금지

**이유**
- 현재 원본 이미지는 **장면당 고정 Storage 경로**(`images/{cid}/{enc}/scene_{N}.{ext}`)를 사용한다.
- 같은 경로를 AI가 쓰면 원본 Storage 객체가 **덮어써진다**(복구 불가).
- 따라서 AI 결과는 반드시 **별도 RTDB 노드 + 별도 Storage 경로**에만 저장한다.

---

## 3. 현재 조사 결과 요약 (AUDIT-1 / 1B)

- 원본 이미지는 **`scene.imageData` 우선, `scene.imageUrl` fallback**(렌더 `scene.imageData || scene.imageUrl`).
- `imageData` 값 = Storage download URL(v114 이후) 또는 구작품 base64 dataURL.
- 업로드·그림판 **모두 `viewerUploadImageToStorage`** 사용(viewer-edit.js).
- Storage 원본 경로는 **`images/{cid}/{enc}/scene_{N}.{ext}`로 장면당 고정** → 재업로드는 원본 객체 덮어씀.
- 삭제는 RTDB `imageData:null`만 수행, **Storage 객체 삭제 안 함**(이미지용 delete helper 부재; video만 존재).
- 이미지 렌더에는 **variant hook이 없음**(텍스트는 `_getDisplayStyle`/`_getDisplayBody` 존재, 이미지는 raw 필드 직접 사용).
- `aiVariants .write:false`(database.rules.json) → **클라이언트 직접 write 불가**(서버 admin SDK 전용).
- `ai-images/**`는 현재 `storage.rules`에서 **막힘**(`/images/**`·`/videos/**`만 허용, 그 외 `false`).
- Functions에는 **이미지 모델 SDK 없음**(`@anthropic-ai/sdk`만, 이미지 생성/편집 미지원).
- `imageS1`/`imageS2`는 **서버 게이트(`MODE_KEY_MAP`)와 admin UI(`AI_MODE_DEFS`)에 이미 배선**됨.
- admin UI에서는 `soon:true`라 **비활성(체크박스 disabled + "준비 중" 태그)**.
- viewer에는 **이미지 AI 버튼이 아직 없음**(클라 게이트는 텍스트 s1/s2/check만 호출).
- `policy.allowViewerToggle`은 aiSettings에 **저장되지만 현재 어디서도 읽지 않음(미사용 예약 필드)**.
- aiSettings 저장 payload는 imageS1/imageS2를 **항상 명시 포함** → 누락/삭제 위험 없음. 서버는 키 누락을 false로 안전 처리 → **마이그레이션 불필요**.

---

## 4. 저장 구조 설계

### Firebase (RTDB)

AI 이미지 결과 저장 위치 (텍스트 variant의 sibling):
```
classes/{classId}/teams/{encodedTeam}/aiVariants/image/{sceneId}/s1
classes/{classId}/teams/{encodedTeam}/aiVariants/image/{sceneId}/s2
```
- **클라이언트 write 금지**(rules `aiVariants.write:false`).
- **Functions Admin SDK로만 저장**(텍스트 `saveTextVariant`와 동일 패턴).

필드 후보:
```js
{
  url,              // Storage download URL (감상/렌더용)
  storagePath,      // Storage 객체 경로 (cleanup/삭제용)
  sourceMode,       // "upload" | "draw" — 생성 시점의 작품 imagePolicy
  basedOnImageHash, // 생성에 사용한 원본 이미지 hash (stale 판정)
  model,            // 사용한 이미지 모델 식별자
  targetFrame,      // 생성 화면 조건 메타 (6장 참고)
  fitPolicy,        // "keep-original-aspect" 등
  finalizedAt,      // 확정 시각
  modifiedByUser,   // 사용자가 이후 손댔는지
  modifiedAt,
  modifiedBy,
  stale             // 원본 변경으로 stale 여부 (12장 참고)
}
```

### Storage

AI 이미지 저장 경로 후보:
```
ai-images/{classId}/{teamName}/scene_{sceneId}_{variant}_{timestamp}.png
```
- 기존 `images/.../scene_{N}.{ext}` 경로와 **절대 분리**.
- **timestamp 포함** + **variant 포함** → 원본/다른 variant와 충돌 불가.
- 기본은 **Functions Admin SDK 업로드**.
- 클라이언트 직접 업로드는 **권장하지 않음**(위조·원본 오염 위험).
- 단, `ai-images/**`는 현재 storage.rules에서 막혀 있음 → Admin SDK 업로드면 rules 수정 불필요(14장 미결).

---

## 5. imagePolicy 설계

작품 단위 `imagePolicy`가 필요하다.

후보 위치 (orientation 등 작품 단위 메타 옆):
```
classes/{classId}/teams/{encodedTeam}/viewer-meta/imagePolicy
```

필드:
```js
{
  sourceMode: "upload" | "draw" | null,
  lockedAtSceneId,
  lockedAt,
  lockedBy
}
```

**정책**
- 기존 작품은 sourceMode를 **자동 추정하지 않는다**(현재 upload/draw 구분 필드 없음 → 추정 위험).
- **첫 이미지 AI 사용 시 선택 모달**로 upload/draw를 고르게 한다.
- 한 번 선택하면 **작품 단위로 lock**.
- draw와 upload는 안내 문구·안전 기준을 다르게 적용할 수 있다.
- `viewer-meta`는 rules상 `auth != null`이면 클라 write 가능 → 학생도 덮을 수 있음. **lock 무결성이 중요하면 추후 서버 callable 저장으로 격상** 가능.

---

## 6. targetFrame / fitPolicy 설계

조사 결과, 현재 그림책 이미지는 고정 crop이 아니라 **contain 계열**이다(`.pb-illust__photo`가 자연비율, flex-center로 letterbox).

**기본 설계**
- 원본 비율 유지.
- 장변 max **1600px** 후보(현 `_compressImageDataURL`과 동일 기준).
- `fitPolicy: "keep-original-aspect"`.
- split/imageCenter/landscape/portrait 정보를 targetFrame에 **기록**.
- imageCenter는 제목·본문이 이미지 위 오버레이이므로, **중요 요소가 하단/중앙 텍스트에 가리지 않도록** 프롬프트 안내 필요.

targetFrame 후보:
```js
{
  frameKey,      // 예: pb-split-landscape / pb-split-portrait / pb-imagecenter
  orientation,   // project.pageOrientation (landscape|portrait) — 작품 단위
  submode,       // scene.picturebookSubmode (split|imageCenter) — 장면 단위
  aspectRatio,
  targetWidth,
  targetHeight
}
```

**주의**
- targetFrame은 **"원본을 잘라 맞추는 기준"이 아니라 "어떤 화면 조건에서 생성했는지 기록하는 메타데이터"**에 가깝게 시작한다.
- P5 1단계에서는 crop/pad보다 **원본 비율 유지가 우선**이다.

---

## 7. 렌더 / 토글 설계

현재 이미지는 raw `scene.imageData || scene.imageUrl`을 직접 사용하므로 **신규 hook이 필요**하다.

**설계**
- `_getDisplayImage(scene)`(또는 유사) helper 신설.
- image variant가 있으면 variant url 사용.
- 없으면 원본 `imageData || imageUrl` fallback.
- **textVariant와 imageVariant는 독립**.
- 기존 `aiViewMode`(텍스트 전용)를 **이미지와 공유하지 않는다**.
- 별도 상태 예:
  - `aiImageViewMode`
  - localStorage key도 텍스트와 분리(텍스트는 팀별 분리 viewMode 키 사용).
- 기본값은 `original`.
- 후보 없는 variant는 **원본 fallback**.
- fallback 상태에서 **원본 저장으로 오염되지 않도록 edit lock** 필요(8장).

렌더 수정 범위(참고): viewer-render.js의 imageData 사용처는 picturebook/text/movie/ending 등 6+곳 → 회귀 범위 큼. 텍스트 variant가 `_getDisplayStyle`/`_getDisplayBody`로 끼어드는 패턴을 그대로 따라 이미지 hook을 같은 지점에 추가한다.

---

## 8. 편집 잠금 설계

AI image variant 보기 중에는 원본 이미지 편집 경로가 오염될 수 있다.

**잠가야 할 것**
- 이미지 업로드(`.js-pb-image-upload-input`)
- 그림판 저장(`_openPbDrawModal`)
- 이미지 삭제(`.js-pb-image-remove`)
- 이미지 flatten(`_flattenImageTransform`)
- `imageTransform` 저장 여부는 **별도 판단**(원본 비파괴 변형이지만 variant view에서의 의미를 14장에서 결정).

**정책**
- **original image view에서만** 원본 이미지 업로드/삭제/그리기 허용.
- image variant view에서는 원본 이미지 변경 버튼을 **잠금 또는 안내**.
- AI variant 자체 편집 기능은 **P5 범위 밖**.
- candidate 없는 variant fallback 상태에서도 **원본 이미지 저장 fallback 금지**(텍스트 variant fontSize에서 sid 없으면 저장 안 하는 패턴과 동일 철학).

현재 업로드/삭제 핸들러는 viewMode와 무관하게 동작하므로 **신규 가드가 반드시 필요**하다.

---

## 9. Functions 설계

새 callable 후보:
```
callImageAiS1
callImageAiS2
```
P5에서는 우선 **`callImageAiS1`만** 고려한다.

**서버에서 재사용할 것**(이미 일반화됨)
- origin 검증
- kill switch
- `_validateRequest`
- `MODE_KEY_MAP.imageS1`(이미 존재)
- aiSettings gate
- quota
- safety/precheck 구조

**새로 필요한 것**
- 이미지 모델 SDK 또는 API 호출 방식
- 새 secret
- 원본 이미지 다운로드/fetch(imageData가 Storage URL인 경우)
- imageData가 base64인 경우 처리(구작품)
- Storage Admin SDK 업로드
- `basedOnImageHash` 계산
- `aiVariants/image` 저장
- 실패 시 원본 유지 안내

**주의**
- 현재 functions는 **Anthropic SDK만** 있음(이미지 생성/편집 불가).
- 이미지 모델 제공사는 **아직 미정**.
- **OpenAI/Gemini 등 제공사 결정 전 구현 금지.**

---

## 10. 권한 / UI 설계

**관리자**
- `imageS1`/`imageS2`는 adminConsole `AI_MODE_DEFS`에 **이미 존재**(load/save/payload/게이트 모두 배선됨).
- 현재 `soon:true`라 비활성.
- P5 구현 시점에 **`imageS1`만 `soon` 해제** 가능.
- `imageS2`는 계속 **준비 중 유지 권장**.
- 관리자 UI 신규 구축 불필요 — 활성화만 하면 됨.

**viewer**
- 현재 이미지 AI 버튼 없음.
- 텍스트 AI 버튼 패턴(`_isModeAllowedByTeacher`로 노출 제어)을 **재사용**.
- 교사가 `imageS1:false`이면 버튼 **숨김**(텍스트와 동일 — 비활성이 아닌 숨김).
- `imageS1:true`일 때만 이미지 정돈 버튼 노출.
- viewer에는 **준비 중 버튼을 노출하지 않는** 쪽 권장.

**policy.allowViewerToggle**
- 현재 저장만 되고 미사용.
- image variant 감상자 토글 허용 여부를 제어하는 데 사용할 수 있음.
- 다만 텍스트도 아직 enforcement가 없으므로, **이미지에서만 먼저 적용할지 별도 결정 필요**(14장).

---

## 11. quota / 비용 / 실패 정책

**권장 방향(결정 필요)**
- 이미지 quota는 **텍스트와 별도 한도**.
- 작품/브랜치당 `imageS1` **2회 정도의 강한 제한**.
- 같은 원본 hash로 중복 생성 시 **경고 또는 재사용** 고려.
- 실패해도 원본 `imageData`/`imageUrl`은 **절대 변경하지 않음**.
- 실패 문구에는 반드시 **"원본 그림은 그대로 유지됩니다"** 포함.

---

## 12. stale 정책

원본 이미지가 바뀌어도 기존 AI variant는 **삭제하지 않는다**.

**정책**
- `basedOnImageHash` 저장.
- 현재 원본 hash와 다르면 **stale로 표시**.
- stale이어도 **삭제하지 않음**.
- 편집자에게는 **강하게 안내**.
- 감상자에게는 작게 안내 또는 숨김 여부 결정(14장).
- **재생성 권장**.

---

## 13. 구현 순서 제안

1. **P5-IMAGE-DESIGN-1** — 본 문서화 (현재 단계)
2. **P5-IMAGE-POLICY-1** — `imagePolicy` 저장/선택 모달 설계 및 최소 구현
3. **P5-IMAGE-VARIANT-1** — imageVariant read/render hook + `imageViewMode` 토글만 구현, **생성 없음**
4. **P5-IMAGE-LOCK-1** — image variant view에서 업로드/삭제/그리기/flatten 잠금
5. **P5-IMAGE-SERVER-1** — `callImageAiS1` 서버 skeleton + permission/quota/hash/storage path 검증, **실제 모델 호출 없음**
6. **P5-IMAGE-MODEL-1** — 이미지 모델 제공사/SDK/secret 결정 후 실제 API 연결
7. **P5-IMAGE-QA-1** — 실 이미지 1회 생성, 원본 오염 없음, F5 유지, stale 안내 검증
8. **P6 이후** — `imageS2` 그림책풍 변환은 별도 단계

**중요**
- 바로 모델 호출 구현으로 가지 말 것.
- 먼저 **variant 렌더와 잠금으로 원본 오염 방지 구조**를 만든 뒤 서버 생성으로 갈 것.

---

## 14. 미결 결정사항 (체크리스트)

- [ ] 이미지 모델 제공사: OpenAI / Gemini / 기타 — **(최대 전제, 먼저 결정)**
- [ ] imagePolicy를 viewer-meta 클라 write로 시작할지, 서버 callable로 잠글지
- [ ] imageS1 quota 기준
- [ ] allowViewerToggle을 image에 먼저 적용할지
- [ ] 감상자 image variant 토글 허용 여부
- [ ] imageTransform을 variant view에서 어떻게 다룰지
- [ ] base64 구작품 imageData 처리 방식
- [ ] 팀/작품 삭제 시 ai-images cleanup 방식
- [ ] Storage rules를 수정하지 않고 Admin SDK만 쓸지
- [ ] imageS2를 언제 열지
