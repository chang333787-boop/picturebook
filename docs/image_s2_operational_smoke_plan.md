# imageS2 운영 smoke 계획 (배포 직전, 승인 후 실행)

> 2026-06-29. feature `feature/image-s2-first-generation`. **이 문서는 계획이다. 아래 절차는 사용자 승인 후 별도 루프에서만 실행한다.**
> 실행 전제: 개인정보 검토 완료 + secret 등록 + Functions 배포 + aiSettings 플래그 ON.

## 0. 사전 게이트 (모두 충족해야 smoke 시작)
1. 🔴 개인정보 검토 결론(국외 이전·미성년·ZDR) — `image_s2_privacy_notice_candidate.md` TODO 해소.
2. secret 등록(`IMAGE_OPENAI_API_KEY`) — `image_s2_deployment_gates.md` §배포 명령.
3. Functions 3종 배포.
4. aiSettings 플래그 ON(테스트 학급만).

## 1. 대상 (작게)
- **테스트 학급 / 테스트 팀** 또는 **비공개 작품**만. 실 학생 공개 전.
- **이미지가 있는 장면 1~2개만**.

## 2. 절차
| # | 단계 | 확인 |
|---|---|---|
| 1 | secret 등록 | `functions:secrets:get IMAGE_OPENAI_API_KEY`로 존재 확인(값 노출 X) |
| 2 | Functions 3종 deploy | deploy 성공·함수 ACTIVE |
| 3 | aiSettings 플래그 ON | 테스트 학급 `modes.imageS2=true`(+권장 플래그) |
| 4 | 교사 세션에서 'AI 그림책 마감' 버튼 노출 확인 | 교사만 보임 |
| 5 | **장면 1개만** 변환 시작 | `callImageAiS2` 호출 |
| 6 | 진행률 확인 | job 노드(`aiVariants/imageJobs/{jobId}`) 폴링 정상 |
| 7 | 결과 생성 확인 | `aiVariants/image/{sid}/s2` 에 url 기록 |
| 8 | 원본 ↔ AI 비교 | `resolveSceneImageSource` 미리보기, 원본 무수정 |
| 9 | AI 결과 사용(적용) | `callApplyImageS2Selection({selected:'s2'})` → `aiVariants/imageSelections/{sid}` 기록 |
| 10 | 새로고침 후 선택 유지 | selection 노드 유지 |
| 11 | 원본 유지로 복귀 | `selected:'original'` 적용 → 정상 복귀 |
| 12 | 비용 로그 확인 | Functions 로그 `[ai/imageS2] result` status/code(원문 미노출) |
| 13 | 오류 로그 확인 | 콘솔/Functions 오류 0 |
| 14 | 학생 세션 버튼 미노출/생성 거부 확인 | 학생은 생성·적용 불가(서버 `permission-denied`) |

## 3. 중단 기준 (하나라도 발생 시 즉시 중단·롤백 검토)
- 원본 이미지 덮어쓰기 발생
- 학생에게 생성/적용 노출
- 비용 폭주(예상 장당 ~$0.05 대비 과다)
- 300초 timeout
- 결과 저장 실패
- 선택 후 새로고침 시 불일치
- 개인정보 gate 무시
- 콘솔/Functions 오류

## 4. live 감상 렌더 후속 (이번 범위 아님)
- 현재 AI 선택 결과는 `aiVariants/imageSelections`에 저장되나 **live 감상 렌더에는 미연결**(`resolveSceneImageSource` 함수는 구현, render hook 미연결 — `image_s2_deployment_gates.md` §4).
- smoke에서는 **선택 저장까지만** 검증. 감상 화면 반영은 별도 후속 루프(render resolver 연결 + 기존 image display 경로 전수 조사 + fallback/stale 테스트)에서 진행.

## 5. 롤백
- aiSettings `modes.imageS2=false`로 즉시 차단(생성·적용 게이트 닫힘).
- 필요 시 secret 제거(`functions:secrets:destroy`)로 not-configured 복귀(생성 0).
- 원본은 어떤 경로로도 미수정 — 데이터 롤백 불요.
