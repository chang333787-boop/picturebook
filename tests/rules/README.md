# RTDB 보안 Rules 테스트 (tests/rules)

운영 `database.rules.json`을 Firebase **Database Emulator**에 로드해 read/write 허용·거부를 검증한다. 운영 Firebase에 연결하지 않으며 테스트 프로젝트(`demo-branch-rules`) + 가상 fixture만 사용한다.

## 사전 요건
- **Java 21+** (Database Emulator 필수). `JAVA_HOME`이 PATH에 있어야 한다.
  - 이 저장소 검증 환경: Temurin JRE 21을 `~/.local/jdk/`에 설치 후
    `export JAVA_HOME="$HOME/.local/jdk/jdk-21.0.11+10-jre/Contents/Home"` / `export PATH="$JAVA_HOME/bin:$PATH"`.
- Firebase CLI(전역), Node 20+.

## 설치
```bash
cd tests/rules && npm install
```

## 실행
```bash
cd tests/rules && npm test     # firebase emulators:exec --only database "node --test"
```
- 정본 `../../database.rules.json`을 그대로 로드해 검증한다.

## 라벨
- `CURRENT_VULNERABILITY` — 현재 Rules의 취약점 재현(SEC-2에서 거부로 뒤집을 대상).
- `MUST_PRESERVE` — 보안 전환 후에도 유지돼야 하는 동작(공개 감상·교사 관리).
- `TARGET` (todo) — SEC-2 목표 Rules가 적용되면 활성화.

## SEC 단계 메모
- **SEC-2 범위 = READ 자식별 조건부화 + isPublic 강제**. **scenes/viewer-meta WRITE는 `auth!=null` 유지**(write를 member-scoped로 조이면 membership 로그인(SEC-4) 전 maker 쓰기 회귀) → write 강화는 membership 정본화 후 원자 배포로 분리.
- MUST_PRESERVE는 현재 Rules와 SEC-2 후 모두 참이어야 하는 동작. TARGET(todo)는 SEC-2 Rules 적용 시 활성화.

## 주의
- 운영 데이터 복사 금지. fixture(`fixtures.js`)만 사용.
- `database-debug.log` 등 emulator 산출물은 `.gitignore`(`*.log`)로 제외.
