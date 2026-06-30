# 가지 imageS2(AI 그림책 마감) — main 병합 전 릴리즈 감사 (2026-06-30)

> IMAGE-S2-RELEASE-AUDIT-LOOP. **read-only 감사 + 문서 정정만** 수행. main merge·Functions deploy·secret 변경·실 OpenAI 호출·실학급 ON·DB migration 없음.
> 감사 기준 commit = `6bb757e` (feature/image-s2-first-generation). origin/main = `622f50f`.

## 1. 요약

- **판정: `IMAGE_S2_RELEASE_AUDIT_PASS_WITH_NOTES`** — main 병합 안전. Critical/High 차단요인 0건. Medium/Low 후속 항목 및 운영 권장 사항 존재.
- 기능·서버·데이터보존·권한·비용·캐시 6개 차원 전부 코드 근거로 PASS.
- 배포된 Functions = HEAD 코드와 일치(마지막 functions 수정 `19d2137` 이후 deploy 완료, `6bb757e`는 클라 전용). **병합을 위한 추가 deploy 불필요.**
- 문서 P3/P4 표기 오류 2개 파일 정정함(코드 정본 = P4-v1). 그 외 문서 교차참조 보강은 후속 권장.
- **운영 위험 1건**: junglim(class_2026_junglim_1) `aiSettings.modes.imageS2 = true`(현재 ON). 교사 세션 전용이라 병합 차단요인 아님. 전체공개 전 OFF 권장.

## 2. 현재 commit / 변경 범위

- feature 브랜치 = `feature/image-s2-first-generation`, HEAD = `6bb757e` = origin (tracked clean, node_modules만 untracked).
- `origin/main(622f50f)..HEAD` = **29 commit** (Phase-0 문서 ~ UX 정리).
- 변경 파일군: `functions/image-s2-*.js`·`functions/index.js`(서버), `viewer-*.js`·`adminConsole.js`·`viewer.html`·`maker.html`(클라), `docs/image_s2_*`(문서), `tests/image-s2-*`(테스트).
- **database.rules.json = origin/main 대비 무변경** → Rules 이미 live(aiVariants `.write:false` 포함), rules deploy 불필요.
- main repo(`picturebook-repo` @ 622f50f)·PB-MOOD worktree 무접촉.

## 3. 배포 상태

| 함수 | 배포 | 세대/리전/런타임 | secret |
|---|---|---|---|
| callImageAiS2 | ✅ live | v2 callable · asia-northeast3 · nodejs20 | `IMAGE_OPENAI_API_KEY`만 연결 |
| callStartImageS2Batch | ✅ live | v2 · asia-northeast3 · nodejs20 | 없음(계획만, 정상) |
| callApplyImageS2Selection | ✅ live | v2 · asia-northeast3 · nodejs20 | 없음(선택 기록만, 정상) |
| callImageAiS1 (skeleton) | ✅ live(게이트됨) | v2 · asia-northeast3 · nodejs20 | 없음 |

- `firebase functions:list` 실측. **HEAD functions 코드 == 마지막 deploy(19d2137) functions 코드**(diff 0) → 운영 함수와 코드 일치.
- secret: 코드에 `defineSecret('IMAGE_OPENAI_API_KEY')`만(하드코딩 sk- 0). 값 미출력.

## 4. 기능 체크리스트 (차원 1·5)

| 항목 | 위치 | 판정 |
|---|---|---|
| AI 설정에 'AI 그림책 마감' 표시 / imageS1 UI 미노출 | adminConsole.js AI_MODE_DEFS (~322-329) | PASS |
| AI 작품 다듬기 모달 imageS2 카드 (교사+그림책만) | viewer-ai.js `_showModeModal` (~3089-3149) | PASS |
| 학생 세션 카드/버튼 미노출 | viewer-ai.js(isEditSess)·viewer-image-batch-ui.js(isMakerAuthSession) | PASS |
| imageS2 OFF→시작 불가 / ON→가능 | viewer-image-batch.js `computeBatchGate` (26-35) | PASS |
| 결과 비교 버튼: 좌 원본 유지 / 우 AI 결과 사용 | viewer-image-batch-ui.js (~213-220) | PASS |
| 일반+엔딩 렌더 발행선택 반영 | viewer-render.js text:412·picturebook:588·ending:1564 (getPublishedImageDisplaySrc) | PASS |
| 원본/AI 보기 토글(imageS1 제거·s2없으면 미표시) | viewer-ai.js `_showAiImageToggleBar` (~2599-2617) | PASS |
| 원본 토글 버그 수정(명시 'original' vs null) | viewer-ai.js `_getDisplayImageSrc` (~1447)·viewer-data.js (~1704) | PASS |
| '모든 페이지 적용' 그림책 엔딩 포함 | viewer-edit.js `_includeEnding`(text\|\|picturebook) (~2798) | PASS |
| floating 버튼 기본 미표시(?debugImageS2=1만) | viewer-image-batch-ui.js (~238-244) | PASS |
| 비용/시간 표시·중복클릭 방지·partial failure·'창닫으면 멈춤' 안내 | viewer-image-batch(-ui).js | PASS |
| P4 promptVersion 다르면 재생성, 같은 P4 cached | viewer-image-batch.js `CURRENT_PROMPT_VERSION='imgS2-p4-v1'`·`isVariantCurrent` | PASS |

## 5. 데이터 보존 (차원 3)

- 원본 `scene.imageData`/`imageUrl` = **read-only**(생성 경로 어디서도 write/overwrite 없음). 결과는 `ai-images/` Storage + `aiVariants/image/{sceneId}/s2`에만.
- 선택 = `aiVariants/imageSelections/{sid}`(callApplyImageS2Selection 서버 전용, 클라 직접 write 없음).
- Storage 원본 `images/` 삭제 코드 0. 실패 cleanup은 `ai-images/` 신규 객체 prefix 한정.
- SSRF 가드 `_downloadImageS2Source`: `firebasestorage.googleapis.com` + `storage.googleapis.com`(우리 버킷 별칭) + `data:`만, `images/` 접두·`..` 차단.
- stale/legacy marker(`sourceModeInferred`/`legacyImagePolicy`), promptVersion이 dedup/stale 판정에 포함.

## 6. 권한 / 학생 미노출 (차원 4)

- 서버 게이트(3종 전부): auth 필수 → aiSettings.modes.imageS2 → `meta/teacher_uid === uid` 또는 super_admin.
- `aiVariants` Rules `.write:false`(origin/main 이미 live) → imageSelections 자식 포함 클라 직접 write 불가. Admin SDK 전용.
- 클라: 학생 감상 세션엔 카드/floating/시작버튼 미주입(from=maker / isMakerAuthSession 게이트).
- AI 전체 토글(enabled)은 imageS2 우발 ON 안 함(개별 modes 키).

## 7. 비용 / 쿼터

- 장당 $0.05 표시, 배치 변환 장면 수·예상 시간(50~70초) 안내.
- 작품별 월 쿼터 imageS2=60(이전 30→실작품 20장+재시도 누적 대응). 전역 일일 500·root 50 안전상한.
- not-configured(secret 미등록)면 생성·차감 0. partial failure 정확 집계(0성공시 '결과 미생성' 안내).

## 8. 캐시 / PWA (차원 6)

- service-worker.js = **network-only**(Cache Storage 미사용) → 구버전 JS 캐시 위험 없음.
- viewer.html cachebuster: 최근 imgs2uipolish1/2·imgs2render1·imgs2ending2 등 반영. maker.html: imgs2settings1.
- HEAD(6bb757e) 수정 파일(viewer-ai/edit/image-batch-ui/viewer.html) cachebuster 갱신 확인.
- (권장) 릴리즈 노트에 "하드 리로드 안내" 한 줄.

## 9. 테스트 결과

- **node 테스트 28개 파일 전부 PASS(0 fail).** 어설션: image-s2 계열 = data 17·published-render 16·adapter 12·generation 27·model-eval 12·pilot 13·policy 29·prod-batch 8·prod-openai 10·ui-smoke 7·viewer-image-batch 10. 회귀 = thought-compass 15파일·polish-auth·membership-login 전부 PASS.
- `node --check` 변경 JS 35파일 0 에러. precommit-check 통과. secret grep 0(defineSecret만).
- ⚠️ rules 에뮬레이터(database.rules.test / lock-emulator / policy-rules) **미실행** — Java 런타임 부재(환경 제약). **단 database.rules.json은 origin/main 대비 무변경**이라 비차단(이전 58/58 ×3 기검증).

## 10. 운영 상태 (read-only)

- classes = 3개(class_2026_junglim_1, cls_mp7zw77l_ZRWwi0, cls_mq7m8eyk_mjm9nJ) — 비정상 증가 없음.
- **imageS2 ON 학급 = junglim 1곳뿐**(`modes.imageS2=true`, 2026-06-30T00:49Z 갱신=테스트). 나머지 2학급 aiSettings 없음(=OFF).
- smoke 테스트 클래스(`cls_smoke_20260629`) = null(정상 정리됨).
- junglim imageJobs = null(비정상 running 잔존 없음).
- **권장: 전체공개 전 junglim imageS2 OFF**(교사 세션 전용이라 학생 미노출=긴급 아님).

## 11. Critical / High / Medium / Low

- **Critical: 0**
- **High: 0**
- **Medium**:
  - (운영) junglim imageS2 ON 잔존 — 전체공개 전 OFF 권장.
  - (코드 정리) callImageAiS1 skeleton이 운영 배포돼 있음 — admin UI에서 imageS1 토글 제거됨(켤 수 없음)이라 안전하나, 후속 dead-code 정리 대상.
  - (운영) P3→P4 전환: 기존 P3 변형은 promptVersion 정책상 재생성 대상이나 자동 일괄 변환은 아님(교사 재생성/일괄 시 갱신). 운영 공지 권장.
- **Low**:
  - 문서 교차참조 부족(개별 문서만 보면 배포 상태 혼재 인상). 본 감사 문서가 중앙 상태 요약 역할.
  - debugImageS2=1 URL 공유 시 floating만 노출(저위험).

## 12. main merge 가능 여부

**가능(PASS_WITH_NOTES).** Critical/High 0. Rules·Functions 추가 deploy 불필요(이미 live·코드 일치). 병합은 클라 + 이미 배포된 서버 코드.

## 13. merge 전 사용자 수동 확인 항목

1. (선택) database.rules.json `aiVariants/imageSelections`에 명시적 `.write:false` 추가 여부 — 현재 부모 cascade로 이미 차단됨(불필요하나 명시성).
2. 라이브 감상 시각 확인(실 교사 세션): 일반+엔딩 장면 AI 결과/원본 토글, '모든 페이지 적용'.
3. 전체공개는 별도 게이트(개인정보 정식반영 = under-13·국외이전·보호자 안내·EXIF 제거 TODO) 통과 후.

## 14. merge 후 운영 권장

- main 병합 후에도 학급별 imageS2 기본 OFF 유지. 검증 끝나면 junglim OFF.
- 개인정보 정식방침 확정 전에는 전체공개 보류.
- 라이브 감상 렌더 resolver는 메인 장면 적용 완료(표지/landing은 원본 유지=의도, 후속).

## 15. 후속 작업 후보

1. 개인정보 정식반영 → 전체공개(법무/정책).
2. junglim 깨끗한 재변환 1회 완주(P4 전 장면+엔딩 시각 확인).
3. callImageAiS1 skeleton / imageS1 server dead-code 정리.
4. 관리자 팀카드 진입점(openImageS2 자동오픈) 문서화/구현.
5. P3→P4 기존 결과 일괄 재생성 UX(교사 '다시 생성' / 일괄).
6. EXIF 제거 단계 확인(개인정보 TODO).
