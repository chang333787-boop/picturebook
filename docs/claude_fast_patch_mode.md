# Claude 작업 속도 운영 규칙 (SPEED-CLEAN-1)

이 문서는 가지(branch) 저장소에서 Claude가 작업할 때 **불필요하게 느려지는 루틴을 줄이기 위한** 운영 규칙이다.
작업의 위험도에 맞춰 조사·검증·보고의 무게를 다르게 적용한다.

> 안전 정책(허용/금지 파일, 원본 scenes 보호, deploy 승인)은 그대로 유지한다. 이 문서는 "안전을 줄이는" 문서가 아니라
> "위험이 낮은 작업에 과한 절차를 붙이지 않기 위한" 기준이다.

---

## 1. 빠른 패치 모드 (fast)

**적용 대상**: UI 버그, 캐시 버전 갱신, 작은 JS 수정, 사용자 노출 문구, 원인이 이미 한두 함수로 좁혀진 문제.

**하지 말 것**
- 전체 파일·전체 저장소 광범위 조사
- MEMORY.md / 모든 topic md 재독해
- **새 하니스 작성 (원칙적으로 금지)**
- 장문 보고 (수십 줄)

**할 것**
- **기존 정답 경로 먼저 찾기**: 새 로직을 만들기 전에 이미 잘 동작하는 비슷한 기존 경로를 먼저 찾아, **기존 경로 / 새 경로 / 차이점 3줄 대응표**로 비교한다. 단, 전체 파일 정독이 아니라 **해당 함수 주변만** 확인한다.
- 수정하려는 함수와 **직접 연결된 함수만** 확인한다.
- **검증은 새 하니스 대신**: 기존 검증 스크립트를 재사용하거나, 안 되면 **3~5개 핵심 케이스만 inline으로** 확인한다.
- 검증 = `node --check <파일>` + `git diff --name-only` + 금지파일 diff 0 확인.
- 보고는 **10줄 이내**.
- commit / push 전에는 멈추고 사용자 승인을 받는다.

---

## 2. 표준 모드 (standard)

**적용 대상**: viewer-ai.js / viewer-edit.js / viewer-render.js 의 상태·저장·토글 로직 등 중간 위험 변경.

**할 것**
- 기존 정답 경로 ↔ 새 경로를 1:1로 대응시켜 비교한다.
- 필요하면 **그 변경에 한정된 focused harness**만 만든다 (전체 회귀 하니스 X).
- commit 전 보고.

---

## 3. 안전 모드 (safe)

**적용 대상**: `functions/index.js`, `functions/prompts.js`, `database.rules.json`, `storage.rules`, Firebase 운영 데이터, 저장 구조, 원본 `scenes` 에 영향을 주는 변경.

**할 것**
- 조사 단계와 구현 단계를 분리한다.
- 하니스·검증을 강화한다 (서버 핸들러 격리 구동 등).
- 배포(deploy) 전 반드시 사용자 승인.

---

## 4. find / grep / rg 범위 제한

검색이 217M 규모(주로 `node_modules`, 스크린샷 아카이브)를 훑으면 느려진다. 기본적으로 다음을 **제외**한다.

- `node_modules`
- `.git`
- `scripts/screenshots`
- zip / archive / backup 류 묶음 파일

예시:

```bash
# 핵심 소스만 직접 지정해서 검색 (가장 빠름)
rg "pattern" viewer-edit.js viewer-ai.js viewer-render.js

# 디렉터리째 검색해야 할 때 무거운 경로 prune
find . -path ./node_modules -prune -o -path ./scripts/screenshots -prune -o -type f -print
```

---

## 5. 메모리 인덱스 관리

- `~/.claude/projects/-Users-dobuk/memory/MEMORY.md` 의 인덱스 항목은 **1줄 / 약 200자 이내**로 유지한다.
- 상세 내용은 각 topic md 파일에 둔다. 오래된 항목은 **삭제하지 말고** 아카이브 섹션으로 압축한다.
- 최신 baseline / 최신 commit / 다음 단계만 인덱스 본문에 남긴다.
