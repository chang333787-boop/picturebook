# 다듬기 화면 전수조사 결과 (Polish Editor Deep Audit)

> AI 이미지 구현 전 다듬기 안정화. branch `feature/polish-editor-deep-audit`, base `origin/main` (b71d5fc).
> 운영 무접촉(배포·병합·운영 DB·실 학생 데이터 없음). 7영역 read-only 구조 survey(에이전트 fan-out) + 정적/브라우저 확정.
> ⚠ 본 문서는 **조사·확정 + 승인 항목 분류**까지다. 제품 정책 변경·재현 미완 수정은 **승인/재현 후** 별도 진행(프롬프트 규칙).

## 0. 조사 범위
viewer-edit.js · viewer-render.js · viewer-ai.js · viewer-data.js · ui.js · mobileTextBranch.js · firebase.js · v03-modes.css · viewer.css · maker.html · viewer.html.

## 1. 다듬기 상태 구조 (정본 데이터 → 저장 → 로드/정규화 → 렌더)
| 영역 | 정본 데이터 | 저장 | 로드/정규화(공유?) | maker↔viewer |
|---|---|---|---|---|
| 원본 본문 | `scenes/{num}.body` | firebase.js `_flushPushToFirebaseNow`(.update child) | `adaptScenes`(id=String(num)) | 동일 `_getDisplayBody` |
| AI 1/2단계 | `aiVariants/text/{sceneId}/{s1\|s2}` (+localStorage 백업) | viewer-ai `_saveVariant{Body,Layout,Style}Patch`→`saveTextVariant` callable(600ms debounce·낙관버퍼) | `_loadFirebaseTextVariants`(메모리캐시) | viewMode별 `_getDisplay{Body,Layout,Style}` |
| 말풍선/글상자 | scene `picturebookSubmode`,`pbCardTone`; choice `viewer-meta.presentation.{sid_cid}` | `saveSceneText`(.update allowlist)·`saveViewerMeta`(deep-path) | `loadTeamData`+`applyPresentationData` | `_renderScenePicturebook` 인라인 위치 |
| 글씨체/크기/색 | scene `textStyle`(+override marker)·작품 `viewer-meta.textDefaults` | `saveSceneText`/`saveProjectTextDefaults`(.update) | `getTextStyle`(작품기본+sparse override, 공유) | `_patchTextStyle`/`_patchPbStyle` post-render |
| 테마 | scene `textTheme`·작품 default | 동일 saveSceneText/Defaults | `getTextTheme`(공유) | `data-text-theme` + CSS 변수 |
| 새 브랜치/복사/BASE10 | scenes child(num key) | addScene·copyScene·redeemCopyCode·`_writeBase10IfEmpty` | adaptScenes | 동일 |

핵심: maker/viewer는 **같은 정규화(getTextStyle/getTextTheme/_getDisplay*)**를 공유 — 구조적으로는 일치 설계.

## 2. 확정된 버그/이슈 (정적·코드 레벨)
### F-1 [P1·확정] 그림책 폰트 피커가 미로드 폰트 8종을 제공
- 로드 폰트(maker/viewer 동일 Google Fonts URL + galmuri) = **10종**: gothic, batang, pen, gaegu, hanna, jua, galmuri, cormorant, hahmlet, diphylleia → `VALID_TEXT_FONTS`(viewer-data.js:1109)와 정확히 일치.
- **그림책 피커**(viewer-edit.js:3339 `FONTS`)는 **18종** 제공: 위 10 + 미로드 8종(**notosans, dodum, notoserif, stylish, dohyeon, himelody, yeonsung, dokdo**).
- 텍스트모드 피커는 10종(정상). 그림책 피커만 구버전(T-THEME-1 이전) 잔존.
- 결과: 그림책에서 8종 중 하나 선택 → 미로드 → 시스템 fallback(기기마다 다름) → **"글씨체가 라벨과 안 맞음"**(사용자 보고와 일치).
- 코드 의도(viewer-data.js:1106 주석): "피커 선택 가능 = TEXT_FONT_FAMILIES 매핑 + viewer/maker 로드 + VALID_TEXT_FONTS 등록 3조건" → 8종은 조건 미충족(레거시 보존용, 신규 선택 대상 아님).
- ⚠ **승인 항목**: "글씨체 목록 삭제"는 사용자 판단 사항. → 3. 승인 항목 A.

### F-2 [P2·정보] '주아(Jua)' 특정 글자 fallback
- maker/viewer **동일 로드**(불일치 아님). `family=Jua`(weight 미지정 → 400만). 브라우저 canvas glyph 검출은 이 환경에서 부정확(CJK·웹폰트 지연·시스템폰트 혼입)이라 자동 확정 실패.
- 가설: Jua(Google Fonts) glyph 커버리지에서 '쫒'(U+CBD2)/'쫓'(U+CBD3) 등 일부 음절 누락 → fallback. **실기기/공식 coverage 데이터로 확정 필요**. 폰트 파일 교체·추가 금지(프롬프트) → 해결은 일관 fallback stack 또는 안내(승인 항목 A 동반).

### T-1 [P1·코드확정] 그림책 폰트 매핑 vs allowlist 불일치
- `TEXT_FONT_FAMILIES`(viewer-edit.js:457, 18 매핑) ⊃ `VALID_TEXT_FONTS`(viewer-data.js, 10). F-1과 동일 근원. (functions/index.js `VARIANT_TEXT_FONTS`도 교차 점검 대상.)

## 3. 승인 필요(제품 정책) — 코드 수정 전 사용자 결정
- **A. 그림책 폰트 피커 정렬**: 권장 = 텍스트모드처럼 **10종(VALID_TEXT_FONTS)으로 정렬**(레거시 8종은 기존 저장값 렌더 호환 유지, 신규 선택만 제거). 대안 = 8종을 실제 로드(Google Fonts 공식 URL 추가·family명 검증 필요). → F-1/F-2 동시 해소.
- **B. 말풍선/글상자·글자 스타일의 variant(original/s1/s2)별 독립 정책**: 현재 `_getDisplayLayout/Style`는 **variant별 독립**(없으면 원본 fallback). AI 단계 전환 시 말풍선/스타일이 "달라 보이는" 체감의 주원인. 작품/장면 공통으로 통일할지 = 정책 결정.
- **C. 테마 변경 시 글자 크기 처리**: 테마 reset(viewer-edit.js:6003)이 `textTheme`만 지우고 `fontSize` 유지 → 테마 바꿔도 크기 유지. 의도(크기 보존)인지 테마 기본 복귀인지 = 크기 정책 결정.

## 4. 재현 필요(풀앱 E2E·blind 수정 금지) — 후속 보정 대상
프롬프트 규칙상 재현 전 코드 변경 안 함. 다음은 maker+viewer+emulator+fixture(scenes/variants)로 재현 후 최소 수정 권장. **→ 이번 세션 정적 재판정은 §8.2 참조(AI-1은 코드상 해결 확인, N-1/N-2는 서버측 게이트, AI-2는 보고).**
- **N-1 [P1] 삭제 장면의 aiVariants orphan**: `removeSceneFromFirebase`(firebase.js:964)가 `scenes/{num}`만 제거, `aiVariants/text/{sceneId}` 미제거 → 같은 num 새 장면 생성 시 stale variant 오염 가능. (데이터 정합 버그·정책 아님 → 재현 후 수정 적합)
- **N-2 [P2] copyScene key 정규화**: `redeemCopyCode`(firebase.js:1160) src→dst 복사 시 key(string/numeric) 정규화 없음·aiVariants 별도 노드 → sceneId 불일치 가능.
- **AI-1 [P1] viewMode 전환 시 contenteditable/drag 핸들 DOM 재생성**: 편집 중 전환 시 포커스/리스너 stale(데이터는 버퍼 보존, UX 거슬림).
- **AI-2 [P2] FB variant 메모리 캐시 stale**: 타 탭/기기 저장 반영 안 됨(1회 preload).

## 5. 안전 원칙 준수
- 원본 repo 무수정: local main `db06e60`·origin/main `b71d5fc`·PB-MOOD 5파일 cmp `e95ac358…` 보존.
- 배포·main 병합·운영 DB write·실 Anthropic·AI 이미지 호출 없음.
- 본 루프 산출물 = 이 문서(조사 결과) + (안전·재현 확정 시) 최소 수정. blind 수정·제품 정책 변경 없음.

## 6.5 적용된 수정 (이번 세션 — 사용자 승인)
### F-1 [수정 완료] 8 미로드 폰트 실제 로드 (사용자 결정 = "8종 실제 로드")
- 근원 확정: 인프라(TEXT_FONT_FAMILIES 매핑·`--font-*` CSS 변수 v03-modes.css:2306-2315·렌더 `--text-ff`·normalize 보존)는 **이미 18종 지원**. 유일 누락 = **Google Fonts URL에 8종 미포함**.
- 수정: maker.html:15 · viewer.html:14 의 css2 `<link>`에 8 family 추가 — `Noto Sans KR`(wght 400;700)·`Noto Serif KR`(400;700)·`Gowun Dodum`·`Do Hyeon`·`Hi Melody`·`Yeon Sung`·`East Sea Dokdo`·`Stylish`. (family명은 Google Fonts에서 200 검증·코드 `--font-*`/매핑과 일치. dokdo=`East Sea Dokdo`.)
- 검증: 브라우저 그리드 스크린샷에서 8종 전부 **고유 서체 렌더 확인**(이전 fallback → 정상). 회귀: compass 189·membership 20·precommit 통과. 2파일(maker/viewer)만 변경, 폰트 파일 추가 없음(공식 URL만).
- 미적용 대안(B): 피커를 10종으로 트림은 사용자가 "8종 로드"를 택해 채택 안 함.

### F-2 [확정·코드변경 없음] 주아 '쫒/쫓' glyph 커버리지 누락
- 64px 확대 스크린샷에서 '가나꽃닭삶앉읽'은 균일 주아체이나 '쫓'·'쫒'만 다른 서체 → **Jua 폰트 자체가 해당 음절 미포함 → fallback** 확정(maker/viewer 동일·로딩 버그 아님).
- `--font-jua` stack에 이미 일관 fallback('Apple SD Gothic Neo','Malgun Gothic',sans-serif) 존재. 원인은 **Jua 폰트 자체의 glyph 누락**으로 fallback 발생(로딩/스택 버그 아님). 현재 범위에서는 **문서화·보류** — 폰트 교체 또는 별도 안내(예: 해당 글자 입력 시 알림)는 **추후 제품 결정** 사항(이번 루프에서 변경 안 함). "추가 개선 불가"가 아니라 "현 범위 보류".

## 7. 다음 단계 제안
1. ~~폰트 피커 10종 정렬~~ — **폐기**. 사용자 결정 = "8종 실제 로드"(§6.5 F-1 완료). 피커 **18종 전부 로드 상태**이며 10종 트림 대안은 채택 안 함. (이 항목의 옛 "10종 정렬" 권장은 무효.)
2. 3-B(variant별 말풍선/스타일 독립)·3-C(테마↔글자크기) 정책 결정 — **미결(보류)**.
3. §4 후속 버그 — §8.2 재판정 참조(AI-1 해결·N-1/N-2 서버측·AI-2 보고).

## 8. POLISH-AUTH-FIX — maker→다듬기 permission_denied (이번 세션, commit `91ce521`)

### 8.1 인증 P1 (수정 완료 + E2E 검증 완료)
- **증상**: maker에서 다듬기(`viewer.html?edit=1&from=maker`) 진입 시 비공개(v2) 작품 `permission_denied`.
- **원인**: viewer.html은 firebase.js(default app)를 로드하지 않고 viewer-data.js가 named `'viewer'` app에서 **별도 익명 로그인** → maker(default app 익명 UID, `members/{uid}/status='active'`)와 **다른 UID** → v2 scenes Rules(`isPublic || 멤버 active || teacher_uid || super_admin`)에서 거부. (firebaseConfig는 maker/viewer 동일·setPersistence 없음 → 기본 LOCAL.)
- **수정(A안 + Phase J 범위 확장)**: `from=maker` 세션(다듬기·완성본 보기·교사 보기 = `isMakerAuthSession`)에서는 **default app 사용** → 같은 origin·[DEFAULT]·apiKey라 persisted maker UID가 복원됨. `loadTeamData`는 복원 대기 후 읽는다(레이스 차단). **편집(edit=1)**은 복원 실패 시 새 익명 로그인 금지 + 안전 안내 + 만들기 복귀 버튼(하드 차단). **완성본/미리보기(비편집)**는 공개 작품도 있어 차단하지 않고 진행(비공개는 Rules가 거부). 공개 감상(`from` 없음)은 named 'viewer' app + 익명 그대로(byte-unchanged·편집 코드는 편집 세션에서만 실행).
  - **범위 확장 근거(Phase D/J)**: `from=maker`는 maker/교사 내부 진입(다듬기·완성본 보기·교사 대시보드)에서만 생성되고 **외부 공유 URL엔 없음**(공유는 클래스 코드 → entry 화면, `from` 미부착). 무로그인 사용자가 `from=maker`만 붙여도 default app에 UID가 없어 권한 상승 불가(Rules가 비공개 거부). → 비공개 **완성본 보기**도 본인 권한으로 정상.
- **파일**: viewer-data.js(isMakerAuthSession/isEditViewerSession/getViewerApp/_awaitMakerAuth/게이트/export)·viewer-edit.js·viewer-ai.js·viewer-locks.js(앱 getter 통일+편집 세션 익명 가드)·viewer-entry.js(복귀 버튼)·viewer.html(cachebuster). **Rules·firebase.json·functions 무변경.**
- **검증 — 정적/단위**: node --check 5/5·polish-auth 단위 **15/15**·compass 189·membership 20·precommit·폰트 18종 maker/viewer 유지.
- **검증 — Rules Emulator (JRE 21 Temurin `~/.local/jdk/jdk-21.0.11+10-jre`)**: `tests/rules` **48/48 × 3회 동일·0 fail**. 신규 `polish-auth-scenes.test.js`로 매트릭스 명시: active member→private 허용·**teacher→private 허용**·non-member→private 거부·anonymous→private 거부·공개 보존(scenes+viewer-meta).
- **검증 — 실 브라우저 E2E (Playwright + Auth 9099 + Database 9000 에뮬레이터, 실제 viewer-data.js 로드)**:
  - **F 학생 maker→다듬기**: maker default-app UID `Zi2…` persist → 다듬기 페이지에서 **동일 UID 복원**(makerUid===viewerUid)·`getViewerApp()=[DEFAULT]`·비공개 scenes **read OK**.
  - **G 교사 maker→다듬기**: teacher_uid로만(멤버 아님) 복원 UID `Yp3…`·비공개 **read OK**(teacher_uid 규칙).
  - **H 새로고침**: 동일 UID 복원·read OK.
  - **J 완성본 보기(from=maker, edit 없음) 비공개**: `[DEFAULT]`·maker UID·**read OK**(확장 효과).
  - **I 공개 감상(from 없음)**: `getViewerApp()=viewer`·새 익명 UID(default UID와 분리)·public read OK — **maker UID 미유출**.
  - **I 비멤버/세션없음 + 편집**: 복원 UID null·**default app 자동 익명 로그인 안 함(defaultUid=null)**·비공개 **PERMISSION_DENIED**(우회 없음).
  - **L Auth race**: 성공 페이지 콘솔 에러 0 — read 전 premature permission_denied 없음(`viewerAuthReady` await가 read보다 먼저).
  - QA 스캐폴딩(임시 하니스·`qa-firebase.json`·에뮬레이터)은 검증 후 전부 제거(미커밋).

### 8.2 후속 버그 정적 재판정 (§4)
- **N-1 [확정·서버측]**: `removeSceneFromFirebase`(firebase.js:964)는 `scenes/{num}`만 제거(dbRef=scenes), `aiVariants/text/{sid}` 잔존 → num 재사용 시 stale variant 오염. **진짜 버그가 맞으나** `aiVariants` Rules가 `.write:false`(클라 write/delete 불가)라 **클라이언트 수정 불가** → 서버(Admin SDK/콜러블)에서 삭제하거나 적용 시 freshness 검증 필요. functions deploy·Rules 변경 금지 루프이므로 **서버 작업으로 이관**.
- **AI-1 [재현 안 됨·해결됨]**: contenteditable 편집은 `aiViewMode==='original'`일 때만 허용(viewer-render.js:515/650/1216). variant 전환(`_setAiViewMode`, viewer-ai.js:2352)은 **변경 전에 `_flushPendingSave()` 호출**(2356-2359)하고 original 복귀 시 리스너 재바인딩 → 데이터 유실/리스너 stale 코드상 방어됨. **코드 결함 없음**(라이브 UX 점검은 권장).
- **N-2 [서버측·라이브 필요]**: copy는 `redeemCopyCode` 콜러블(서버) 경유 + aiVariants `.write:false` → 클라 키 정규화 무관. 실제 영향은 서버 복사 로직·라이브 재현 필요 → **이관**.
- **AI-2 [확정·보고]**: `_loadFirebaseTextVariants`는 `.once()` 1회 preload + 메모리 캐시(팀 변경 시만 무효화), **라이브 리스너 없음** → 타 기기 저장은 새로고침/재진입 전까지 미반영. 단 동시 같은-팀 편집은 advisory-lock(viewer-locks.js)이 차단. force-refresh는 perf/제품 영향 → **제품 결정 보고**(임의 수정 안 함).
