# imageS2 프롬프트 P4 — "완성형 그림책 마감" (2026-06-29, 배포됨)

## 배경
기존 P3는 보존이 강해 결과가 "정돈된 스케치" 수준 — 학생 그림의 거친 크레용 질감이 남아 빈 공간/배경이 연했다. 사용자 요구: **학생 구도·캐릭터·수/위치·이야기·말풍선·손글씨는 유지하되, 배경·빛·색·질감·공간 밀도를 꽉 채운 "완성된 그림책 한 장"** 으로 마감.

## P4 변경 (functions/image-s2-adapter-openai.js `OPENAI_S2_PROMPT`)
- 목표 재정의: "improve only its finish" → **"fully finished picture-book illustration … like a published storybook page."**
- 배경/빈공간: "only … simple, natural way" → **"fill every empty or blank-white area and the whole background … Leave no unfinished white paper. Add rich but natural color, soft storybook lighting, gentle depth, atmosphere, hand-painted texture."**
- 매체: **수채 + 색연필 따뜻한 손그림, 아늑한 색감, 손맛 유지.**
- **보존 가드 유지**: 같은 캐릭터/동물/사물의 수·위치·포즈·구도, 추가·삭제·병합·분할·이동 금지, 얼굴/손/몸 재설계 금지(같은 캐릭터로 정제만), 손글씨·말풍선 그대로 보존, 이야기/시간대/날씨 유지.
- **부정**: photorealistic/3D/glossy commercial·anime/특정 작가·스튜디오 금지.
- 프레임: 3:2 가로(1536×1024), 중앙 fit, crop/shift 금지.
- 버전: adapter `PROMPT_VERSION='imgS2-openai-gpt-image-2-P4-v1'`, generation `PROMPT_VERSION='imgS2-p4-v1'`(변형 태그).

## 테스트 (실 OpenAI, 격리 fixture·junglim 원본 2장 사용·junglim 무변경)
junglim/0000 장면 1(인물2+강아지+나무+길)·장면 8(거의 빈 흰 종이+나무+해+구름+캐릭터+손글씨)로 P3 vs P4 비교:
- **장면 1**: P4가 길가 풀·꽃·층진 나무·하늘 구름·깊이감으로 완성. 인물 2명·강아지·나무 수/위치·포즈 보존.
- **장면 8**: P4가 따뜻한 수채 하늘·뭉게구름·과일나무·먼 산·풀밭·햇빛으로 완성(빈 종이 0). 2캐릭터·슬픈 구름·뱀·손글씨("오이야긔"/"꾸에엥") 위치·문자 보존.
- 판정: **P4 채택**(완성형 목표 달성·보존 가드 통과·과하지 않음). 새 인물/동물 추가 없음(배경 환경 fill만), 재설계 없음.

## ⚠️ 적용 주의 (dedup)
변환 dedup 키 `basedOnImageHash`는 (originalSrc, sceneId, sourceMode) 기반 — **promptVersion 미포함**. 따라서:
- **이미 P3로 변환된 장면**은 일반 재시작 시 dedup 재사용 → P4로 자동 안 바뀜.
- **미변환 장면**만 새로 P4 생성 → 한 작품에 P3/P4 혼재 가능.
- 기존 작품 전체를 P4로 통일하려면 **forceRegenerate 경로 필요**(현 batch UI 미노출). 후속: ①해시에 promptVersion 포함(프롬프트 변경 시 자동 무효화·비용↑) 또는 ②교사용 "다시 생성" 버튼. junglim/0000은 현재 P3 변형 보존(이번 테스트는 별도 fixture).

## 배포
`firebase deploy --only functions:callImageAiS2` (Successful update). 신규 변환부터 P4 적용.
