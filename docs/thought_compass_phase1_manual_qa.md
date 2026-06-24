# 생각 나침반 Phase 1 — 로컬 수동 QA 패키지

> feature branch `feature/thought-compass-phase1`(worktree `../picturebook-thought-compass-phase1`) 전용.
> **운영 main에 병합하지 않고**, 운영 Firebase 데이터를 바꾸지 않고 수동 QA하는 방법.
> 자동 QA(node --test)는 통과 상태. 이 문서는 사람이 브라우저에서 흐름을 확인하기 위한 절차다.

## 0. 안전 원칙
- 운영 Firebase 데이터 변경 **금지**. 아래 1순위(Emulator)를 권장.
- 실제 운영을 써야 한다면 **테스트용 새 학급/모둠**만 사용. 기존 학생 작품 금지.
- PIN을 문서·로그·스크린샷에 남기지 말 것.
- feature branch 파일을 로컬 HTTP server로 제공(직접 file:// 아님 — 일부 브라우저 차단).

## 1. 권장 1순위 — Firebase Emulator + 로컬 HTTP + AI stub
실 외부 AI(Anthropic)·운영 DB를 건드리지 않는다.

### 사전 준비
- **Java Runtime 필요**(database/functions emulator). 미설치 시 `firebase emulators`가 "Unable to locate a Java Runtime"으로 실패한다 → JDK 설치(예: Temurin 17+).
- 의존성 설치:
  ```
  cd functions && npm install && cd ..
  cd tests/rules && npm install && cd ../..
  ```

### 실행
1. Functions/DB/Auth 에뮬레이터:
   ```
   # AI 실호출 없이 결정적 stub 사용(키 불필요)
   TC_FOLLOWUP_STUB=1 firebase emulators:start --only functions,database,auth --project demo-branch
   ```
   - 콜러블 `callThoughtCompassFollowUp`은 `FUNCTIONS_EMULATOR=true`(에뮬레이터가 자동 set) + `TC_FOLLOWUP_STUB=1`일 때만 stub 응답(빈답→ASK_EASIER, 짧은답→ASK_FOLLOW_UP, 충분→NEXT). 운영 코드 경로엔 영향 없음.
2. 정적 파일 서버(worktree 루트):
   ```
   python3 -m http.server 8765 --bind 127.0.0.1
   ```
3. 브라우저에서 `http://127.0.0.1:8765/maker.html?...` 진입. (Firebase SDK를 에뮬레이터에 연결하는 QA용 설정은 firebase 초기화부에서 `useEmulator` 연결 후 사용 — 운영 config로 접속하지 말 것.)
4. RTDB 규칙 검증(별도, concurrency 1):
   ```
   cd tests/rules && npm test && npm test && npm test && cd ../..
   ```
   (`compass.test.js`가 editSession/writingGuide/onboarding member·teacher RW를 검증.)

### 가상 fixture
- 테스트 학급/모둠: `classes/demo-class/teams/<enc>` 아래 `members/{uid}/status='active'`를 에뮬레이터에 시드.
- 신규 작품 강제 게이트 확인: scenes 비움 + onboarding/version 미설정 상태에서 ptype 선택 → 게이트.

## 2. 대안 — 순수 클라이언트 하니스(흐름·UI만)
백엔드 없이 UI/흐름만 빠르게 보려면, store/AI를 mock한 임시 HTML 하니스로 `ThoughtCompassUI.open(...)`/`ThoughtCompassReview.open(...)`을 직접 호출(개발 중 사용한 방식). 게이트·membership·실저장은 검증 못 함.

## 3. 수동 QA 체크리스트 (25)
1. 신규 그림책 생성 → 생각 나침반 강제 게이트(닫기/우회 불가)
2. 신규 텍스트 생성 → 강제 게이트
3. movie/experience → 게이트 없이 기존 진입
4. 질문 1~7 한 화면 한 질문, 진행률 N/7
5. 보기 선택으로 답변
6. 직접 적기(빈/공백은 다음 비활성)
7. 모르겠어요 1단계(쉬운 안내, 같은 보기) → 2번째 클릭 시 “이야기를 만들면서 정할래요”
8. 중간 종료(새로고침) 후 재접속 → 저장된 질문부터 이어서
9. AI NEXT(충분한 답 → 다음 질문)
10. AI ASK_FOLLOW_UP(모호한 답 → 후속 한 화면)
11. AI ASK_EASIER(어려워함 → 쉬운 보기)
12. 후속 최대 5회 → 6번째부터 후속 없이 진행
13. 전체 최대 12문항 → 상한 도달 시 NEXT 강제
14. 최종 검토 화면(7항목 + 후속답변 세로 목록)
15. 검토에서 특정 질문 “고치기” → 수정 후 검토 복귀(다른 답 보존)
16. “이 생각으로 시작하기” → 완료(누락 있으면 거부)
17. 완료 후 기본 장면 약 10개(표지1·일반8 직선·엔딩1·버튼1) 생성
18. 기존(optional) 작품 → 상단 진입 버튼만(강제 아님)
19. optional 시작 후 → 완료까지 강제(이탈해도 in_progress 게이트)
20. 동시 편집: 두 번째 사용자 read-only(“다른 친구가 작성하고 있어요”)
21. 3분 무활동(heartbeat 끊김) 후 → 이어받기 제안 → 확인 시 편집권 이전, 이전 편집자 read-only
22. clearAll(장면 전체 지우기) 후에도 생각 나침반 유지(PRE-01)
23. 작품 복사 후 → 생각 나침반 강제(PRE-02, copiedFrom)
24. 공개 viewer(감상) 회귀: 정상
25. 학생 로그인(membership) 회귀: 정상

## 4. 자동 QA 현황(이 환경 기준 — QA 루프에서 실행 완료)
- node --check: compass 클라 11 + functions 3 = 통과
- node --test tests/thought-compass/*.test.js: 통과(**189**)
- node --test tests/membership-login/*.test.js: 통과(20)
- precommit-check.js: 통과 / database.rules.json·firebase.json: JSON 유효
- **Rules Emulator(JRE 21, `~/.local/jdk/jdk-21.0.11+10-jre/Contents/Home`): 3회 38/38·0 fail** — editSession write 등 보강 4 포함.
- **Emulator E2E 실행 완료** — 게이트·신규/기존/copy·AI 4분기·모르겠어요·editSession·수명주기·반응형. P1×4·P2×1 발견·수정(상세 `qa_results.md`).
- 원본 PB-MOOD 5파일: cmp 동일(shasum `e95ac358…`) 보존.

### JRE 경로(에뮬레이터)
```
export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.11+10-jre/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
```
> ⚠ rules 테스트와 functions/database Emulator는 같은 포트(9000 등)를 쓰므로 **동시 실행 금지**(하나 종료 후 다른 하나).
> functions Emulator E2E: firebase.json에 emulators 블록(auth 9099 등) 임시 추가 필요(QA 후 되돌릴 것 — 운영 배포엔 불요).

## 5. NOT_VERIFIED(실기기/실백엔드 필요 — 위 체크리스트로 확인)
- 실제 게이트 차단·membership write·editSession transaction 경쟁·heartbeat 만료·실 Anthropic 응답.
- iPad/Android 터치·태블릿 가로/세로·학생 사용성.
