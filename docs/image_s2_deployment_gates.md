# 가지 imageS2 — production 파이프라인 상태 & 배포 게이트 (IMAGE-S2-9)

> 2026-06-29. feature `feature/image-s2-first-generation`. **실 API 호출·secret 등록·배포·main 병합 없음.**
> 모델=gpt-image-2 / 강도=P3 확정. 서버 production 파이프라인 결선 완료(mock 검증). 라이브는 아래 게이트 통과 후.

## 1. 완료 (서버, mock 검증)
- `functions/image-s2-adapter-openai.js` — production OpenAI adapter. `createOpenAiImageS2Adapter({apiKey,...})` → `{configured:!!apiKey, generate(req)}`. 고정 **P3 정본 프롬프트**(보존·한글·재설계금지·3:2·사실화금지), `/v1/images/edits`, 출력 MIME/크기/refusal 검증, timeout. fetch/download 주입 → mock 테스트.
- `functions/index.js`:
  - `IMAGE_OPENAI_API_KEY = defineSecret('IMAGE_OPENAI_API_KEY')` (텍스트 Anthropic과 분리).
  - `_selectImageS2Adapter()` — **secret 있으면 OpenAI adapter, 없으면 not-configured**(생성 차단·차감 0=안전 기본 유지).
  - `_downloadImageS2Source()` — **SSRF 안전**: `data:` 디코드 또는 `firebasestorage.googleapis.com` 객체 path만 `admin.storage().bucket().file(path).download()`. 외부 호스트 fetch 0.
  - `callImageAiS2` — `{ secrets:[IMAGE_OPENAI_API_KEY], timeoutSeconds:300 }`(전역 60s override — gpt-image-2 50~70s+). 선택적 `jobId`로 batch 진행상태 갱신.
  - `callStartImageS2Batch` — 교사 전용. 계획(이미지 있는 장면·최신결과 cached·skip) + job 상태 생성(`aiVariants/imageJobs/{jobId}`). **생성 안 함**(MVP: 클라가 targets 를 callImageAiS2(jobId)로 순차 호출).
  - `callApplyImageS2Selection` — 교사 전용. **`aiVariants/imageSelections/{sceneId}`**(★보안: viewer-meta가 아님 — viewer-meta `.write:auth!=null` cascade로 멤버가 직접 덮어 교사게이트 우회 가능 → `aiVariants .write:false`로 이동해 Admin 단독 write, rules 변경 0) 서버 전용 write(s2 usable일 때만). **원본 scene.imageData 절대 미접촉.**
- `functions/image-s2-batch.js` — 순수 batch 상태 머신(plan/init/applySceneResult/computeJobStatus/summarize/resumable).
- 테스트: prod adapter 10 + batch 7 (전체 회귀 350/350).

## 2. Rules / Storage — **변경 불요**
- ai-images 결과 = **다운로드 토큰 URL**(`?token=`)로 표시 → Storage Rules 우회(catch-all read:false여도 표시됨). **storage.rules 변경 0·deploy 0.**
- job 상태·s2 변형·**imageSelections** = `aiVariants/*`(이미 `.read:true·.write:false`=Admin만) 저장 → **DB rules 변경 0 + 클라 우회 불가**.
  - ★ imageSelections를 의도적으로 `aiVariants/imageSelections`에 둠(viewer-meta 아님): viewer-meta는 `.write:auth!=null`이 cascade돼 child `.write:false`가 무효(imagePolicy의 알려진 잔여위험과 동일) → 멤버(학생)가 선택을 직접 덮어 교사 적용 게이트를 우회할 수 있음. aiVariants는 부모 grant 없는 `.write:false`라 Admin SDK 단독 = 우회 차단. read:true라 표시 지장 없음.
  - ⚠️ 후속(클라 표시 연결 시): 표시 reader는 `aiVariants/imageSelections/{sceneId}`에서 읽어야 함(viewer-data.js 주석의 viewer-meta 경로는 갱신 대상). imagePolicy의 viewer-meta cascade 잔여위험은 별개로 Security Phase 유지.

## 3. 라이브 전 게이트 (사용자/운영 결정 필요)
1. 🔴 **개인정보 결론**: 학생 그림이 OpenAI(미국)로 전송 → under-13 ZDR(COPPA)·국외이전 동의·보호자/학교 안내. **미결정 시 배포 금지.**
2. **secret 등록**: `firebase functions:secrets:set IMAGE_OPENAI_API_KEY` (운영 결정). 등록 전엔 not-configured=생성 0.
3. **Functions 배포**: `firebase deploy --only functions:callImageAiS2,callStartImageS2Batch,callApplyImageS2Selection`. (Rules/Storage 불요.)
4. **클라 교사 UI — 방향 결정 필요**(아래 §4).
5. **이미지 일일 비용 상한**: 현재 GLOBAL/ROOT는 호출수 기준. 이미지 USD 상한은 후속.

## 4. 클라이언트 교사 UI — 방향 선택 (미구현·STOP)
조사상 클라 image-AI 표면은 복잡 + 회귀 위험이라 방향 결정 후 진행:
- **진입 게이트**: 기존 `_showImageAiEntryButton`은 **교사 전용이 아님**(학생도 노출). 교사 일괄 UI는 `from=maker`+편집 세션 게이트의 **별도 컨트롤**이어야 함(생각 나침반 `⋯더보기` reveal 패턴 권장).
- **진행률**: `callStartImageS2Batch`→job 생성→클라가 targets 를 `callImageAiS2(jobId)` 순차 호출→job 노드(`aiVariants/imageJobs`) 폴링. body-append 고정바 패턴 재사용.
- **결과 비교/적용**: `viewer-data.resolveSceneImageSource`(원본↔s2 resolver, **이미 구현됐으나 render 미연결**)를 비교 뷰에 사용. ⚠️ render hook(`_getDisplayImageSrc`)을 무리하게 교체하면 현재 AI 이미지 토글 회귀 위험 → 비교는 미리보기로만, 적용은 `callApplyImageS2Selection` 호출(클라 RTDB write 금지).
- **명칭**: "AI 그림책 마감" / "그림책 느낌으로 마감하기".
- **시작 전 안내**(§ PRD): 장면수·예상 시간(장당 50~70초)·예상 비용(장당 ~$0.05)·원본 유지·외부 전송 고지.

## 5. 안전 기본값 (운영 차단 유지)
- imageS2 = `aiSettings.modes.imageS2` 꺼짐이 기본(교사가 명시적 ON). 생성=교사만. secret 없으면 not-configured.
- 학생은 생성/적용 불가(원본 토글 미리보기만). 원본은 어떤 경로로도 미수정.

---

## 6. 배포 준비 재확인 (2026-06-29, IMAGE-S2-PRIVACY-DEPLOY-GATE-LOOP)

### 6-1. 확정 코드 사실 (deploy 영향)
| 항목 | 값 | 근거 |
|---|---|---|
| Firebase project | `picturebook-8731f` | `.firebaserc:3` |
| Functions region | `asia-northeast3`(서울) | `functions/index.js:58` (전역) |
| Node runtime | **20** | `functions/package.json:6` |
| **새 npm 의존성** | **없음** | adapter는 Node20 global `fetch`/`FormData`/`Blob` 사용(`image-s2-adapter-openai.js:12`). `package.json` deps 무변경(firebase-admin/functions + anthropic-sdk만) |
| secret 필요 함수 | **`callImageAiS2`만** | `index.js:2154` `secrets:[IMAGE_OPENAI_API_KEY]` |
| secret 불필요 함수 | `callStartImageS2Batch`(계획+job 생성만, OpenAI 호출 0) / `callApplyImageS2Selection`(선택 기록만) | `index.js:2229`, `2269` — 설계상 정상. 3종 동시 배포 무방 |
| timeout | callImageAiS2 **300s**(전역 60s override), batch/apply 60s | `index.js:2154` |
| 미등록 시 | `_selectImageS2Adapter`→not-configured→`NOT_CONFIGURED`·생성 차단·quota 차감 0 | `index.js:2120,2127` |

### 6-2. secret 등록 명령 (승인 후 실행 — 이 루프에서 실행 안 함)
```
firebase functions:secrets:set IMAGE_OPENAI_API_KEY --project picturebook-8731f
```
- 실제 secret 값은 **묻거나 저장하지 않는다**. 운영자가 직접 입력.
- `defineSecret` 이름과 일치(`index.js:66`). 등록 전엔 not-configured=생성 0(안전).
- 확인: `firebase functions:secrets:get IMAGE_OPENAI_API_KEY --project picturebook-8731f` (값 노출 X).

### 6-3. Functions 배포 명령 (승인 후 실행 — 이 루프에서 실행 안 함)
```
firebase deploy --only functions:callImageAiS2,functions:callStartImageS2Batch,functions:callApplyImageS2Selection --project picturebook-8731f --non-interactive
```
- Rules/Storage 배포 불요(§2). codebase=default(`firebase.json`).
- ⚠️ `firebase deploy`는 **dry-run 미지원**(functions). 대신 배포 전 `node --check` + 단위 테스트로 검증(아래 §6-5).

### 6-4. aiSettings 플래그 (현재 vs 권장)
**현재 코드 게이트 = `aiSettings.modes.imageS2` 불리언 1개**(서버 `index.js:419-427`·클라 경로 동일 `viewer-ai.js:499`).
- 운영 ON: 테스트 학급 `classes/{cid}/aiSettings`에 `enabled:true` + `modes.imageS2:true`. (실제 DB write는 smoke 루프에서만.)

**권장(다음 루프 — 코드 미반영, 본 루프 구현 안 함):** 개인정보 게이트를 코드로 강제하려면 최소 하드닝 후보 —
- `aiSettings.imageS2.privacyAcknowledged === true` 아니면 `callImageAiS2`/`callStartImageS2Batch`가 `permission-denied`(미설정=차단). → "개인정보 안내 확인 전 생성 불가"를 서버에서 보장.
- `aiSettings.imageS2.providerReady === true`(secret/제공자 준비 표식, 선택).
- `aiSettings.imageS2.model`/`costPerImageUsd`(표시·로깅용, 선택).
- ⚠️ 이는 **behavior 변경 + 테스트 추가**가 필요하므로 안전 모드(조사·구현 분리)에 따라 **승인 후 별도 루프**에서 구현. 본 루프는 설계만 문서화.

### 6-5. 테스트 상태 (2026-06-29)
- image-s2 단위 회귀: **111/111 PASS**(policy/generation/prod-adapter/batch/data/ui, 네트워크 0·주입 mock). `node --check` 5개 functions 파일 OK.
- rules emulator 테스트(`tests/rules/image-s2-*`)는 Java 에뮬레이터 필요 → 이번 루프 미실행(코드 무변경이라 회귀 위험 0).
- 실제 OpenAI 호출·secret·deploy·DB write·main 병합 **모두 미실행**.

### 6-6. 운영 smoke
→ `image_s2_operational_smoke_plan.md` 참조(14단계 + 중단 기준 + 롤백).
