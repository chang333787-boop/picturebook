# 마감 전체 회귀 점검 (2026-07-07)

- 기준: origin/main `d0ca7dc` · 오늘 배포분(계정 트랙 6단계 + 감상 성능 + 교사 인쇄 + s2 webp) 이후 회귀 확인
- 방법: 정적 검사 + 테스트 스위트 + 에뮬레이터 + 라이브 스모크(localhost:8000, 실데이터)

## 결과 요약 — **회귀 0, 전부 GREEN** ✅

| # | 항목 | 결과 |
|---|---|---|
| ① | 전 JS 문법 검사(클라+functions, 제외규칙 적용) | **전부 OK** |
| ② | git 동기화 | main == origin/main (미커밋=mockup 잡동사니뿐) |
| ③ | 비-에뮬 테스트 스위트 | **463/463 PASS** |
| ④ | precommit-check(문법·console.log·버스터·위험파일·viewer참조) | **통과** |
| ⑤ | rules 에뮬레이터 스위트 | **90/90 PASS** (기존 79 + HARDEN 후보 11) |
| ⑥ | HTML 참조 파일 존재(404 방지) | **MISSING 0** (viewer/maker/index/branch/teacher-auth) |
| ⑦ | 오늘 버스터 6종 반영 | adminConsole/firebase/ui/compass-review/viewer-render/viewer-ai **전부 확인** |
| ⑧ | 라이브 viewer 스모크 | 21장면 로드·표지→1→선택지→2 정상·콘솔 에러 0(favicon 404만) |
| ⑨ | 라이브 maker 스모크 | 입장화면 정상·콘솔 에러 0 |
| ⑩ | **UX-1 실환경 검증** | 실 클래스 JL26A(legacy_open) 코드→문구 실제 변경(mode read end-to-end) |

## 세부 확인
- **감상 경로**: viewer-ai 지연로드 정상·표지/장면/선택지 이동·전환 무회귀. 오늘 수정(viewdedup1·imgprefetch3·aivarfix1)이 렌더 경로를 깨지 않음.
- **입장 경로**: UX-1 모드별 문구가 실 DB 모드 읽기까지 라이브로 동작 확인.
- **rules**: 운영 database.rules.json 무변경. HARDEN 후보(별도 파일)만 추가돼 에뮬레이터에서 검증(배포 X).
- **테스트 성장**: 비-에뮬 463(오늘 image-s2 webp form/mime 등 추가분 포함)·에뮬 90(HARDEN 11 추가).

## NOT_VERIFIED (코드/하니스는 통과·실계정 클릭만 남음)
- 교사 관리모드: 입장카드 인쇄 미리보기·계정만 삭제·고쳐쓰기/나침반 인쇄
- AI 그림 webp 변환 결과 화면(용량 webp는 실측 완료)
- iPad 실기기 감상 체감(페이드 3→1·그림 즉시)
- 학생 오래된 팀 재입장 안내(실 stale uid 재현)

## 보류/후속 (회귀 아님)
- HARDEN 배포: 활성 학급이라 보류(트리거 대기)
- members 무효화·Storage 고아정리: Functions 후속

## 판정
**마감 회귀 차단 요소 없음.** 오늘 배포한 8개 트랙이 기존 감상·편집·입장·rules 경로를 깨지 않음을 정적+동적으로 확인. 남은 건 실계정/실기기 육안 확인뿐.
