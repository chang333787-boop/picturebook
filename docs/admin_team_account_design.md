# ADMIN-1 교사 관리형 학생/팀 계정 설계

> ⚠️ **이 문서는 설계 문서입니다(docs-only).**
> 코드·rules·functions·storage·deploy는 이 단계에서 변경하지 않습니다.
> 본 문서는 ADMIN-AUDIT-1 감사 결과(HEAD `2080f20` 기준)를 바탕으로,
> 학생/팀 계정을 "학생 자율 생성형"에서 "교사 관리형"으로 **안전하게 전환**하기 위한 청사진입니다.

---

## 1. 배경 — 현재 학생 입장 구조

현재 가지(branch)는 라이브에서 `DATA_PATH_VERSION = 'v2'`로 동작합니다.

- 학생은 **클래스 코드(classCode) + 팀 이름(teamName) + PIN**을 입력해 입장합니다. (`maker.html` join-screen → `firebase.js _joinTeamV2`)
- 입력한 팀이 **없으면**, 학생 입력값으로 **즉석에서 새 팀이 생성**됩니다.
  - `teamRef.child('pin').once('value')`에서 `savedPin === null`이면 → `teamRef.child('pin').set(pin)`.
- **PIN은 처음 입력한 학생의 값으로 저장**되고(선점), 이후 같은 팀명 입장자는 그 PIN을 맞춰야 합니다.
- 학생은 **익명 인증(`signInAnonymously`)**을 사용합니다. (uid는 매 세션 새로 부여될 수 있고, 특정 팀과 묶이지 않습니다.)
- 교사는 관리화면(`adminConsole.js`)에서 **팀 목록 보기 · 상태 진단 · 공개 토글 · 복제 코드 발급 · 팀 삭제(이름 재입력 이중확인)**가 가능하지만,
  **팀 생성 · PIN 설정/변경 · 팀명 변경 · 명단 사전 등록은 불가능**합니다.

관련 경로(현재):

```
classes/{classId}/teams/{teamKey}/pin           # 평문, read 공개
classes/{classId}/teams/{teamKey}/scenes        # 작품 본문
classes/{classId}/teams/{teamKey}/viewer-meta   # 공개여부 등
classes/{classId}/teams/{teamKey}/locks         # 편집 잠금
classes/{classId}/aiSettings                    # 학급 AI 설정
classCodes/{CODE} = classId                     # 코드 → 학급 인덱스
```

> teamKey = `encodeURIComponent(teamName)` (현재는 팀명 자체가 키).

---

## 2. 문제점

ADMIN-AUDIT-1에서 확인된 구조적 약점:

1. **학생이 팀을 무한 생성**할 수 있다. 화이트리스트·승인·개수 제한이 없다.
2. **오타 팀 / 장난 팀 / 유령 팀**이 누적된다. (예: "ㅁㄴㅇㄹ", "2모둠 " ↔ "2모둠")
3. 교사가 **팀명과 PIN을 미리 발급**할 수 없다. (수업 시작 전 명단 준비 불가)
4. **PIN이 평문**이고 `pin .read: true`라 **누구나 읽을 수 있다.**
5. **클라이언트 PIN 비교** 중심이라(읽어서 `===` 비교) 작정하면 우회 가능 — 실 보안이 아님.
6. rules에서 `scenes .write: "auth != null"` → **익명 학생 누구나 다른 팀 scenes를 쓸 수 있다.** 팀별 쓰기 격리가 약하다.
7. 상용 서비스의 표준 흐름("교사가 학급 만들고 학생 계정을 발급")이 **아니다.** 현재는 "학생이 알아서 계정을 만든다".
8. 팀 삭제 시 RTDB만 지워지고 **Storage 이미지/영상(`images/{cid}/{team}/…`, `videos/{cid}/{team}/…`)이 고아로 남는다.**

---

## 3. 목표 구조

```
교사 로그인
  → 학급 선택
  → 팀/학생 계정 사전 생성
  → 팀명 + PIN 발급
  → 학생은 발급된 팀명/PIN으로 입장
  → 교사는 PIN 변경, 팀 잠금, 팀 삭제 가능
```

### 핵심 원칙 (불변)

- **기존 작품 접근을 깨지 않는다.** (현재 학생/교사가 보던 작품은 그대로 열려야 한다.)
- **기존 팀 데이터(scenes/viewer-meta/pin)는 유지한다.** 자동 삭제·차단하지 않는다.
- **전환 기간에는 legacy 팀 입장도 계속 허용**한다. (학급 단위 모드 스위치)
- **rules 변경은 별도 안전 단계로 분리**한다. (클라이언트 잠금 → rules 강화 순서)
- **원본 작품 데이터(scenes / imageData·imageUrl / aiVariants)는 건드리지 않는다.**

---

## 4. 데이터 모델 후보

### 후보 A — 별도 `teamAccounts` 노드

```
classes/{classId}/teamAccounts/{teamKey}
  displayName        # 화면 표시용 팀명
  pin 또는 pinHash    # 단기 평문 / 중기 해시
  status             # active | locked | archived
  createdBy          # 교사 uid
  createdAt
  updatedAt
  lastLoginAt
  linkedTeamPath     # 실제 작품 데이터 경로(예: classes/{cid}/teams/{teamKey})
```

| 관점 | 평가 |
|---|---|
| 기존 호환성 | ◎ 기존 `teams/{key}` 작품 데이터를 그대로 두고 메타만 별도 관리 |
| rules 작성 난이도 | △ 노드가 둘로 나뉘어 교차 검증 규칙이 다소 늘어남 |
| 관리화면 구현 | ◎ 계정 목록을 작품과 분리해 깔끔하게 렌더 |
| maker/viewer 영향 | △ 입장 시 teamAccounts 조회 → linkedTeamPath로 점프하는 한 단계 추가 |
| 마이그레이션 | ◎ 기존 teams는 그대로, teamAccounts만 새로 채우면 됨(비파괴) |

### 후보 B — 기존 `teams` 내부에 `account` 서브노드

```
classes/{classId}/teams/{teamKey}/account
  displayName
  pin 또는 pinHash
  status             # active | locked | archived
  createdBy
  createdAt
  updatedAt
```

| 관점 | 평가 |
|---|---|
| 기존 호환성 | ◎ 작품과 같은 노드 아래라 경로 점프 불필요 |
| rules 작성 난이도 | ◎ `teams/$team/account`만 교사 쓰기로 좁히면 됨(scenes와 동일 부모) |
| 관리화면 구현 | ○ 팀 카드에 account 메타를 함께 묶어 표시 |
| maker/viewer 영향 | ◎ 이미 teams/{key} 경로를 쓰므로 추가 조회 최소 |
| 마이그레이션 | ○ 기존 팀에 account 서브노드만 채워 넣으면 됨(비파괴). 단 기존 `pin`(루트)과 신규 `account/pin` **이중 PIN** 정리 필요 |

### 추천: **후보 B (teams 내부 account 서브노드)**

이유:
- maker/viewer가 이미 `classes/{cid}/teams/{key}` 경로로 동작 → **입장 흐름 변경 최소**.
- rules에서 `teams/$team/account`만 교사 쓰기로 좁히면 되어 **scenes 격리 설계와 같은 부모에서 일관**되게 다룰 수 있음.
- 단, 기존 루트 `teams/{key}/pin`과 신규 `teams/{key}/account/pin`이 공존하므로, **읽기 우선순위(account/pin 있으면 그것, 없으면 legacy pin)** 규칙을 명시해야 함.

> teamKey는 당분간 `encodeURIComponent(displayName)` 유지(팀명=키). 팀명 rename은 키 변경을 수반하므로 **초기 범위에서 제외**(12장 참조). 장기적으로는 `team_${id}` 같은 불변 키 + displayName 분리가 이상적.

---

## 5. PIN 처리 설계 (단기 / 중기 / 장기)

### 단기 (ADMIN-1B~1D)
- **기존 평문 PIN 유지 가능.** 즉시 해시로 바꾸지 않는다(호환 깨짐 방지).
- 교사 관리화면에 **PIN 생성/변경 UI부터** 추가.
- **student create lock**(6장)으로 학생의 신규 팀 생성을 막는다.
- 읽기 우선순위: `account/pin`(교사 설정) 우선, 없으면 legacy 루트 `pin`.

### 중기 (ADMIN-1F 이후)
- PIN을 **hash로 저장**(예: 서버에서 salt+hash). 클라이언트는 평문 PIN을 직접 읽지 않는다.
- 입장 검증을 **Cloud Function 또는 안전한 검증 경로**로 이전(클라이언트 `===` 비교 폐기).
- `pin .read`를 공개에서 닫는다.

### 장기 (상용 수준)
- **팀별 session token 또는 membership mapping** 도입(익명 uid ↔ teamKey 연결).
- rules에서 **scenes 쓰기 권한을 "그 팀에 입장(검증)한 세션"으로 제한**.

---

## 6. 학생 새 팀 생성 잠금 설계

학급 단위 설정으로 제어:

```
classes/{classId}/settings/teamCreationMode
```

| 값 | 의미 |
|---|---|
| `legacy_open` | 기존처럼 학생이 새 팀을 즉석 생성 가능 (하위호환 기본값) |
| `teacher_managed` | 교사가 만든 팀만 입장 가능. 학생 신규 생성 차단 |
| `locked` | 입장 자체를 일시 차단(시험·정리 기간 등) |

대안(단순 불리언):

```
classes/{classId}/settings/allowStudentTeamCreate = true | false
```

| 비교 | enum(`teamCreationMode`) | bool(`allowStudentTeamCreate`) |
|---|---|---|
| 표현력 | ◎ locked 등 확장 용이 | △ 2상태만 |
| rules 단순성 | ○ 문자열 비교 | ◎ 불리언 |
| 향후 확장 | ◎ | △ 결국 enum으로 갈 가능성 |

**추천: `teamCreationMode` (enum).** locked 같은 운영 상태를 자연스럽게 담을 수 있음.

원칙:
- **기존 호환을 위해 설정 노드가 없으면(`null`) `legacy_open`으로 간주**한다. (기존 학급 무손상)
- 새로 만드는 학급은 **`teacher_managed`를 기본값**으로 둘 수 있다(상용 지향).
- 관리화면에 **"학생이 새 팀을 만들 수 있음/없음"을 명확히 표시**한다.

---

## 7. 기존 팀 마이그레이션

기존 팀은 **자동 삭제·차단하지 않는다.**

설계:
- 기존 `teams/{key}`를 읽어, **account 서브노드가 없는 팀**을 "등록되지 않은 기존 팀(legacy)"으로 표시.
- 교사가 팀 카드에서 **"관리 계정으로 등록"** 버튼을 누르면:
  - `teams/{key}/account`를 생성(`displayName` = 기존 팀명, `status: active`, `createdBy` = 교사 uid).
  - 기존 PIN이 있으면 **임시로 가져오거나**(account/pin에 복사) 교사가 **새 PIN을 설정**.
- **기존 작품/scenes는 그대로 유지.** 등록은 메타만 추가하는 비파괴 작업.
- **팀명 변경은 별도 위험 단계**로 분리(키 변경 수반 → 작품 경로 이동 위험).

---

## 8. 관리화면(adminConsole) UI 설계

### 필수 (ADMIN-1B~1E 범위)
- 팀/학생 계정 **생성**
  - 팀명(displayName)
  - PIN
  - 상태(active / locked)
- **PIN 변경**
- **잠금/해제**(status active ↔ locked)
- **학생 입장 안내 복사**(클래스 코드 + 팀명 + PIN 안내 텍스트)
- **등록되지 않은 기존 팀 표시** + "관리 계정으로 등록" 버튼
- **팀 삭제는 기존 강한 확인(이름 재입력) 유지**

### 보류 (이후 단계)
- 팀명 변경(rename)
- 대량 CSV 등록
- Storage cleanup(고아 이미지/영상 정리)
- Auth 계정 삭제

---

## 9. maker/viewer 입장 흐름 영향

대상: `firebase.js _joinTeamV2`(및 v1), maker/viewer join-screen.

| 모드 | 팀 상태 | 동작 |
|---|---|---|
| `legacy_open` | 없음 | **기존처럼** 새 팀 생성 허용 |
| `legacy_open` | 있음 + PIN 일치 | 입장 |
| `teacher_managed` | 없음 | ❌ "선생님이 등록한 팀만 입장할 수 있어요" |
| `teacher_managed` | 있음 + PIN 일치 | 입장 |
| `teacher_managed` | 있음 + status `locked` | ❌ "선생님이 잠근 팀이에요" |
| `locked` | (전체) | ❌ "지금은 입장할 수 없어요" |

핵심 변경(설계만, 구현 X):
- 입장 시 `classes/{cid}/settings/teamCreationMode` + `teams/{key}/account/status`를 먼저 조회.
- `teacher_managed`에서 팀이 없으면 **생성 경로(`pin.set`)로 진입하지 않고** 안내만 표시.
- legacy 호환: 설정이 없으면 `legacy_open`으로 간주 → 기존 동작 그대로.

---

## 10. rules 영향 (이번 문서에서 구현하지 않음 — 영향만)

**단계 분리(순서가 안전의 핵심):**

1. **student create lock을 클라이언트에서 먼저** 적용 (rules는 그대로). → 즉시 효과, 기존 입장 무손상.
2. 이후 rules에서 **신규 pin write 제한**(예: `teamCreationMode`가 teacher_managed면 학생 pin 생성 차단, account는 교사만).
3. 이후 **scenes write를 팀 세션/소유권 기반으로 제한**.

**주의:**
- rules를 **먼저** 바꾸면 기존 학생 입장/저장이 깨질 수 있다. → **클라이언트 잠금 → rules** 순서 엄수.
- 익명 인증 **uid와 team을 연결하는 설계**(membership mapping)가 선행돼야 scenes 쓰기를 안전하게 좁힐 수 있다.
- 단순히 `scenes .write`를 `auth != null`에서 더 막아버리면 **학생 저장이 전부 깨진다.** 반드시 매핑 설계 후.

---

## 11. 구현 단계 로드맵

| 단계 | 내용 | 위험도 | 수정 파일 후보 |
|---|---|---|---|
| **ADMIN-1A** | 설계 문서 완료(본 문서) | 없음 | `docs/admin_team_account_design.md` |
| **ADMIN-1B** | adminConsole 팀 계정 **생성 UI** + `account` 노드 쓰기 | 낮음 | `adminConsole.js` (필요시 `firebase.js` 헬퍼) |
| **ADMIN-1C** | maker/viewer 입장 로직 `teacher_managed` 대응(생성 차단/안내) | **중간** (입장 흐름) | `firebase.js`, `ui.js`, `maker.html`/`viewer` join-screen |
| **ADMIN-1D** | 교사 **PIN 변경 / 잠금(status)** UI | 낮음 | `adminConsole.js` |
| **ADMIN-1E** | 기존 팀 → 관리 계정 **등록 마이그레이션 UI** | 낮음 | `adminConsole.js` |
| **ADMIN-1F** | **rules 강화** 설계/테스트(pin write 제한 → scenes 격리) | **높음** (안전 모드) | `database.rules.json` + 매핑 설계 |
| **ADMIN-1G** | 팀 삭제 시 **Storage cleanup** 별도 Function 설계 | **중간~높음** | `functions/index.js` (신규 callable) |

> 각 단계는 **한 번에 하나씩**. 1C(입장)와 1F(rules)는 운영 데이터에 직접 닿으므로 **안전 모드**로 분리.

---

## 12. 절대 하지 말아야 할 것

- 기존 `teams/scenes` 구조를 **한 번에 갈아엎지 말 것.**
- 기존 평문 PIN을 **즉시 hash로 바꾸지 말 것.** (호환 깨짐)
- **rules를 먼저 바꾸지 말 것.** (클라이언트 잠금 → rules 순서)
- **팀명 rename을 초기에 넣지 말 것.** (키 변경 = 작품 경로 이동 위험)
- 학생 **Auth 계정 개념을 성급히 만들지 말 것.** (익명 인증 + membership 매핑부터)
- **Storage 삭제를 팀 삭제 UI에 바로 붙이지 말 것.** (별도 Function·검증 후)
- **imageS1 설정(soon)과 섞지 말 것.** (AI 로드맵과 분리)

---

## 13. 추천 결론

- **1차 구현(ADMIN-1B~1E)**: "기존 구조 유지 + 교사 팀 생성 UI + `teamCreationMode`"가 가장 현실적이고 안전하다.
  - 데이터 모델은 **후보 B(`teams/{key}/account`)** 채택.
  - `teamCreationMode` 기본값은 **legacy_open(설정 없음=레거시)**, 신규 학급은 **teacher_managed** 권장.
  - PIN은 **단기 평문 유지**, 교사 생성/변경 UI부터.
- **2차 이상(ADMIN-1F~1G)**: PIN hash, rules 기반 scenes 격리, Storage cleanup.
- 상용 서비스 수준으로 가려면 **결국 rules 기반 팀 격리(membership 매핑)까지** 필요하다.
- 그러나 **지금 당장 가장 먼저 해결할 것은 "학생 무한 팀 생성 방지"**다. 이는 ADMIN-1B(교사 생성 UI) + ADMIN-1C(teacher_managed 입장 차단)의 **클라이언트 단계만으로도** 큰 효과를 내며, rules 변경 없이 기존 입장을 깨지 않고 즉시 적용 가능하다.

---

- **문서 상태:** 설계(design) — 구현 전. 본 문서는 ADMIN-1A.
- **기준 HEAD:** `2080f20`
- **다음 단계 후보:** ADMIN-1B (adminConsole 팀 계정 생성 UI)
