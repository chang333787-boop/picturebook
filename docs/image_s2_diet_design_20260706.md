# IMAGE-S2-DIET-1 — AI 발행 그림 용량 다이어트 설계 (2026-07-06)

- 배경 실측: s2 PNG **3.4MB/장** vs 학생 원본 478KB (7배). 20장면 s2 발행 작품 감상 1회 ≈ 68MB.
  예열(IMG-PREFETCH-1/2)이 체감은 가리지만 근본 무게·데이터 사용량은 그대로.
- 상태: **설계만. functions 변경·deploy 없음. 별도 승인 후 구현.**

## 1. 원인
어댑터(functions/image-s2-adapter-openai.js:148-155)가 `/v1/images/edits`에
`size`·`quality`만 보내고 **`output_format` 미지정** → OpenAI 기본값 **무압축급 PNG**(1536×1024).

## 2. 해결 A안 — 생성 시 API가 직접 압축 (권장·재인코딩 라이브러리 불요)
어댑터 form에 2줄 추가:
```
form.append('output_format', 'webp');        /* png|jpeg|webp */
form.append('output_compression', '80');     /* webp/jpeg 시 0~100 */
```
- 기대: 3.4MB → **150~400KB**(-90%). sharp 등 의존성 추가 0.
- 파급 수정(전부 functions):
  - generation.js:19 `ALLOWED_OUTPUT_MIME=['image/png']` → `+ 'image/webp'`
  - generation.js:150 storagePath `.png` 고정 → mime 따라 `.webp`(sniffMime는 이미 webp 인식:adapter 55행)
  - DB는 완성 URL 저장이라 클라 무변경. iPad Safari 14+ webp 표시 OK(대상 기기 충족).
  - webp 거부감/호환 우려 시 `jpeg`+85로 대체(투명도 불요 — 그림책 전면 그림).
- 테스트: 어댑터 단위(mock fetch로 form 필드 검증) + 실 1장 생성 스모크(run-real-one 재사용) +
  용량/표시 확인. 기존 스위트 회귀 0 확인 후 deploy.

## 3. 기존 이미지 20장 (0000 테스트 학급)
- B-1 그대로 둠(권장): 옛 테스트 학급 1개뿐. 신규 생성부터 가벼워지면 실수요 충족.
- B-2 1회 변환 스크립트: 다운로드→`cwebp -q 80`→새 `.webp` 업로드→aiVariants url 갱신(admin write 1회/장).
  운영 DB write가 생기므로 별도 승인·백업 후.

## 4. 순서(승인 게이트)
① 어댑터+generation 수정 + 단위테스트 → ② 실 1장 생성 스모크(비용 ~$0.0x·확인 후) →
③ functions deploy(다른 대기분 C2 origin fail-open 제거·주석복원분과 동승 권장) →
④ 실수업 1회 관측 → (선택) ⑤ B-2 기존분 변환.

## 5. 하지 않는 것
클라 재인코딩(불가) · 학생 원본 재압축(원본 보존 원칙·이번 범위 아님) · sharp 도입(A안이면 불요).
