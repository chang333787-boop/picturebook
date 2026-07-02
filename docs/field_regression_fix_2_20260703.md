# FIELD-REGRESSION-FIX-2 — 출판형 인쇄 1/1 붕괴 수정 + 결과 보기 로드 실패 원인 확정

- 일자: 2026-07-03 · 기준: origin/main `8af5945` · client-only(코드)/Rules는 승인 대기
- 판정: **FIELD_REGRESSION_FIX_2_PARTIAL_PASS** — A(인쇄)=LIVE_PASS · B(결과 보기)=**Rules 승인 필요**

## 왜 보고와 실화면이 달랐나 (교훈)
PUBLISH-PRINT-1 검증 하니스가 **standalone HTML**(pb-ai.css만 로드)이어서 22페이지가 나왔다.
실제 viewer.html에는 화면용 [viewer.css:58] `html, body { height:100%; overflow:hidden }`이 있고,
이 상태에서 Chrome 인쇄는 문서를 뷰포트 1페이지로 잘라버린다 → 사용자 화면의 "표지+지도+장면이
한 장·1/1" 증상. 생각나침반 인쇄는 1장짜리라 이 함정에 안 걸렸고, 그림책/고쳐쓰기 같은
**다중 페이지 인쇄만** 실환경에서 깨졌다. 번들/버스터는 live·local 모두 정상(코드 차이 아님).

## Phase A — 인쇄 클리핑 해제 (수정 완료)
- 수정: 인쇄 open() 게이트에서 `<html>`에 `print-doc-unclip` 클래스 부여/정리(afterprint·타임아웃·
  예외 경로 포함) — picturebook-print.js·viewer-ai.js(_openWriteAfterPrint) 두 게이트 동일 적용.
  pb-ai.css `@media print`: `html.print-doc-unclip, html.print-doc-unclip body { height:auto;
  overflow:visible !important }`. 게이트 인쇄에만 적용(Cmd+P 일반 인쇄·화면 레이아웃 무영향)·
  tc-print(1장·정상 작동 중)는 무변경.
- 검증:
  - viewer.css 포함 하니스에서 **구 상태 재현=1페이지**(사용자 증상 그대로) → **수정 후=22페이지**.
  - **실환경**: 실제 viewer.html(전체 CSS·8000 read-only)에서 mock 20장면 주입 →
    DOM 22페이지·**PDF(A4) 22페이지**·unclip 부여/정리 정상.
  - 고쳐쓰기 인쇄도 같은 게이트 패턴으로 동일 수정(공통 CSS 1곳).

## Phase B — "저장된 질문을 불러오지 못했어요" (원인 확정·Rules 승인 대기)
- alert 위치: viewer-ai.js `_showLatestWriteAfterQuestions`/`_showLatestWorkCheck` — **read 예외
  (catch)에서만** 발생. 데이터 없음 케이스는 이미 별도 부드러운 안내가 있음.
- 원인: **RTDB rules에 `aiChecks` 노드 규칙이 없음** → 기본 거부 → 클라 직접 read가
  permission_denied(교사 포함 전원). **배포 rules를 실조회해 repo database.rules.json과 byte 동일
  확인** — 배포 누락이 아니라 규칙 자체가 처음부터 없었다. functions는 Admin SDK write라 저장은
  정상이지만, 클라의 "결과 보기"·`_preloadWriteAfterLatestFlags`(✅배지·🖨 고쳐쓰기 인쇄 버튼 노출)가
  실환경에서 전부 이 거부에 걸린다. 즉 **P5B 결과 보기·고쳐쓰기 인쇄 버튼은 실환경에서 처음부터
  작동 불가였고**(하니스는 mock DB라 통과), 이번에 실사용으로 드러난 것.
- client-only 우회 없음: latest를 돌려주는 기존 callable 없음(신규 함수=deploy 금지),
  aiVariants처럼 read:true인 사본도 없음. → **중단 조건 해당, Rules 수정안 제시**:

```json
/* classes/$classId/teams/$team 아래에 추가 — scenes와 동일한 팀/교사 read, write는 서버 전용 */
"aiChecks": {
  ".read": "auth != null && (root.child('classes/' + $classId + '/teams/' + $team + '/members/' + auth.uid + '/status').val() === 'active' || root.child('classes/' + $classId + '/meta/teacher_uid').val() === auth.uid || auth.token.role === 'super_admin')",
  ".write": false
}
```
- 성격: 1노드 추가·deploy 1회. 학생 결과는 팀 active member+담당 교사만 read(공개작품 감상자에겐
  비노출 — AI 점검 결과는 팀 내부 자료). 레거시 membership 미기록 팀은 여전히 거부(H-1 백필과 동일
  축). **승인 주시면 RULES 트랙으로 수정+deploy+rules 테스트 진행.**

## 검증·안전
- node --check OK · 테스트 462/462(rules 제외 기존 동일) · 실환경 PDF 22p ·
  functions/rules 파일 diff 0 · AI 호출 0 · DB write 0(실조회는 read-only CLI).
- 버스터 `fieldfix2`: picturebook-print.js·pb-ai.css·viewer-ai.js.

## 남은 후속
- [승인 대기] aiChecks read rules 추가+deploy (→ 결과 보기·인쇄 버튼·✅배지 실환경 복구).
- 실프린터 1회(이제 진짜 다중 페이지로 나옴).
