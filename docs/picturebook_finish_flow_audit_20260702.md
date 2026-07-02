# AI 그림책 마감(imageS2) 전체 흐름 감사 (PICTUREBOOK-FINISH-FLOW-AUDIT)

2026-07-02 · read-only(코드 무수정·AI 호출 0·DB write 0) · main HEAD `7f329a1`(=origin·drift 0)

## 1. 흐름 요약 (현행 라이브)
```
[교사·다듬기 세션(edit=1&from=maker)+그림책+rewriteDone+관리자 imageS2 ON]
 → 작품 마무리 카드 '🖼 AI 그림책 마감'(viewer-ai.js ≈3324)
 → imageS2BatchUi 패널(viewer-image-batch-ui.js) → 게이트(교사+설정+이미지장면>0)
 → callStartImageS2Batch(계획) → 장면별 callImageAiS2(서버: 원본 read-only → gpt-image-2
    → Storage ai-images/ + aiVariants/image/{sid}/s2 저장·quota 차감·dedup·stale)
 → 교사 비교(원본↔s2 토글) → callApplyImageS2Selection('s2'|'original')
 → aiVariants/imageSelections/{sid} (서버 전용 write)
 → 감상/학생: getPublishedImageDisplaySrc가 표시만 s2로 교체(선택 없음/stale → 원본)
```

## 2. 진입/노출 (§1·§5)
- 유일한 진입 = **다듬기 세션 '작품 마무리' 카드**(IMAGE-S2-ENTRY, viewer-ai.js:3236) —
  조건: maker 인증 세션 + **그림책 작품만**(텍스트 미노출) + rewriteDone 게이트 + 관리자 modes.imageS2 ON.
  일반 편집/감상/학생 화면 진입 없음. imageS1(AI 그림 정돈)은 폐기 — s2만.
- 패널 게이트(computeBatchGate): 교사 아님→차단문구·설정 OFF→차단·이미지 장면 0→차단·전부 마감→안내.
  legacy 작품(imagePolicy 없음)은 안내 후 서버가 sourceMode 'upload' 보정(차단 아님).
- 학생에게 버튼이 보이고 실패하는 혼란: **없음** — 카드 자체가 교사 세션에서만 주입.

## 3. 권한 (§2·§6) — 이중 방어 확인
| 층 | 내용 |
|---|---|
| 클라 | 교사 세션에서만 UI 주입 + 게이트 not-teacher 차단 (숨김 수준) |
| 서버 `callImageAiS2` | `_validateRequest`(auth·origin·killswitch·aiSettings·quota·H-1 membership log-only) + **teacher-only 명시 강제**(super_admin 또는 해당 학급 teacher_uid — index.js:2336~2345) |
| 서버 `callApplyImageS2Selection` | 동일 teacher-only 강제 + selected='s2'는 usable(url·!stale)일 때만 |
| 페이로드 | 클라는 sceneId/jobId만 — 임의 URL/base64/prompt/model **서버 normalize에서 거부**(PRD §13) |

→ "클라 숨김뿐 아니라 서버 검증 있음" 확정. 타 팀 접근은 _validateRequest의 class/team 검증 경로.

## 4. 원본 보존 (§3) — 절대 원칙 준수 확인
- **scene.imageData/imageUrl에 쓰는 서버 코드 0** — generation.js 헤더 원칙 명시 + write는
  `aiVariants/image/{sid}/s2`(set)과 Storage `ai-images/`뿐. storagePath는 allowlist+원본경로 차단
  (isAllowedS2StoragePath·isOriginalImageStoragePath) 이중 검사.
- 선택도 원본 미접촉: `aiVariants/imageSelections/{sid}`만 기록. **viewer-meta가 아닌 aiVariants를
  쓴 이유가 주석에 명시**(viewer-meta는 cascade write라 학생 우회 가능 → aiVariants는 .write:false).
- 표시 훅(getPublishedImageDisplaySrc·_getDisplayImageSrc)은 **렌더 지역변수만** 교체 — scene 객체/DB 무변경,
  실패 시 원본 fallback. 텍스트 C-1 같은 "편집 필드 오염" 경로 없음(이미지는 contenteditable 아님,
  직접 그리기 모달은 scene.imageData 원본을 직접 읽음 — 발행 표시값을 저장하는 경로 부재).
- 원본 되돌리기: selected='original' 적용 = 즉시 원본 표시(usable 검사 불요) ✅.

## 5. 직접 그리기/업로드 연결 (§4)
- 직접 그리기: 저장 → Storage URL이 `scene.imageData`에(v114+) → generation gate가
  `scene.imageData || scene.imageUrl` 순으로 읽음 → **DRAWING_TO_IMAGES2_STILL_WORKS** 재확정.
- 업로드: 동일 필드 경로 → **UPLOAD_TO_IMAGES2_WORKS**.
- 빈 소스: originalSrc 없으면 `IMAGE_SOURCE_MISSING` 거부 ✅. 단 **내용 없는 흰 캔버스**(imageData는
  존재)는 가드 없음 — 교사 명시 실행이라 저위험, 후속 후보로 유지(EMPTY_IMAGE_GUARD = 후속·Low).
- dedup: 원본 hash+promptVersion 재사용(중복 차감 0)·재그리기 시 hash 변경→stale→재생성 대상.

## 6. Rules (§7)
- `aiVariants` **read:true / write:false** → variant·imageSelections·textSelections 전부 Admin SDK 전용.
  학생이 selection 우회 조작 불가 ✅. read:true라 감상 표시 정상.
- `scenes.write: auth != null` — 원본 필드는 로그인 사용자가 쓸 수 있는 **기존 전체 편집 모델의 특성**
  (이미 메모리/문서에 기록된 알려진 사항 — imageS2가 새로 만든 위험 아님·별도 트랙).

## 7. UX 평가 (§5)
- 좋은 점: 교사 전용 명확("담당 선생님만"), 비용/시간 추정 표시(PER_IMAGE_USD/SECONDS),
  privacyNotice(외부 AI 안내)·legacyNotice 안내, 후보→비교→선택 구조가 원칙 그대로.
- 개선 후보(전부 Minor): ①"원본 그림은 그대로 남아요" 문구를 패널에 명시 ②편집 세션에서 발행 s2가
  배경으로 보여 "원본이 바뀌었나" 오해 소지(표시는 정상 동작 — 안내만) ③표지(cover) 장면의 s2 적용
  범위가 일반/엔딩 대비 불명확(렌더 훅 3지점: text·pb일반·엔딩) — 표지 정책 확인 필요.

## 8. 위험 등급
- **Critical: 0** — 원본 자동 덮어쓰기 경로 없음·학생 무제한 호출 불가(teacher-only+quota)·타팀 접근 차단.
- **High: 0** — teacher-only 서버 강제 확인·selection 우회 불가(.write:false)·임의 소스 주입 거부.
- **Medium**: ①membership enforce가 아직 log-only(전 AI 공통·별도 트랙 관측 중) ②재그리기 후 기존 s2
  stale 전파가 감상 표시에 실시간 반영되는지 실측 미확인 ③표지 s2 적용 범위 불명확.
- **Low**: ①흰 캔버스 가드 없음 ②"원본 보존" 안내 문구 부재 ③편집 세션 발행 표시 오해 소지
  ④실기기 배치 UI 검증(모듈 주석 스스로 NOT_VERIFIED 표기).

## 9. 전체공개(학생 실행) 전환 판단 — **보류 권장**
현 모델(교사 실행→학생은 결과 감상)이 비용·안전·초상권 안내 책임 면에서 적절. 전환하려면:
학생용 quota 별도 상한 + 흰 캔버스/저품질 가드 + 외부 AI 학생용 안내 + enforce ON 선행 + 비용 승인.
→ 지금 필요 근거 없음(교사 배치 흐름이 수업 모델과 일치).

## 10. 다음 작업 추천
1. (관측) 실 수업에서 배치 1회: 재그리기→stale→재생성, 표지 포함 여부, iPad 표시 확인.
2. (Minor UX·소규모) 패널에 "원본 그림은 그대로 남아요 — AI 결과는 후보로 저장돼요" 1줄.
3. (별도 트랙) membership enforce ON — MEMBERSHIP_ENTRY_FLOW_READY_FOR_ENFORCE 관측 이어서.

## 최종 판정
**PICTUREBOOK_FINISH_FLOW_READY** — Critical/High 0. 진입(교사 전용)·권한(서버 이중)·원본 보존
(read-only+서버 전용 선택)·소스 연결(그리기/업로드/legacy) 전부 원칙대로. Minor UX·관측 항목만 잔존.
