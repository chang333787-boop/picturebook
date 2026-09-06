# 생성형 AI 교육 활용 근거 — OpenAI · Anthropic 공식 정책과 「가지」 설계의 대응

작성 2026-09-06 · 용도: 보호자 동의서 「3. 생성형 AI」·연구보고서 Ⅱ.5·컨설팅 지적("AI 활용 근거") 보강 · 확인 시점 2026-09-06

## 0. 한 줄 결론
두 회사 모두 **"미성년자에게 API 기반 제품을 제공하는 것을 허용하되, 개발자(운영자)가 안전장치를 갖추고 아동 보호·개인정보 법을 지킬 것"**을 조건으로 둔다. 금지가 아니라 **요건**이다. 「가지」는 그 요건(연령 대응·콘텐츠 필터·감독/기록·AI 고지·개인정보 미전송)을 프로그램 안에 구현했고, 아래 표가 항목별 대응이다.

## 1. 공식 문서 인용 (원문 그대로)

### Anthropic — Usage Policy (https://www.anthropic.com/legal/aup)
- "Products serving minors, including organizations providing minors with the ability to directly interact with products that incorporate our API(s), must comply with the additional guidelines outlined in our Help Center article." — *Additional Use Case Guidelines*
- "All consumer-facing chatbots, including any external-facing or interactive AI agent, must disclose to users that they are interacting with AI rather than a human."

### Anthropic — Help Center: Responsible Use of Anthropic's Models: Guidelines for Organizations Serving Minors (https://support.claude.com/en/articles/9307344)
- 조직은 미성년자에게 API 기반 제품을 직접 제공할 수 있으며, "additional safety features tailored to their unique use cases"를 구현해야 한다.
- 안전장치 예시: "Age verification systems to ensure only intended users can access the product" / "Content moderation and filtering to block inappropriate or harmful content" / "Monitoring and reporting mechanisms to identify and address potential issues" / "Educational resources and guidance for minors on safe and responsible use"
- "It is the responsibility of organizations to comply with all applicable child safety and data privacy regulations, such as the Children's Online Privacy Protection Act (COPPA) in the United States."
- "Organizations must disclose to their users that they are interacting with an AI system rather than a human."
- "Anthropic will periodically audit organizations for compliance."

### Anthropic — Commercial Terms (https://www.anthropic.com/legal/commercial-terms)
- "Anthropic may not train models on Customer Content from Services."
- "Customer … owns its Outputs" / "Anthropic hereby assigns to Customer its right, title and interest (if any) in and to Outputs."

### OpenAI — Under 18 API Guidance (https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance)
- "developers should implement additional safeguards when using our API to serve minors (under 18 years old)."
- 요구 안전장치: "Providing age-appropriate disclosures to minors about AI tools and how to use them responsibly." / "Implementing age-appropriate content filters to address potentially sensitive content." / "Implementing reasonable monitoring and reporting mechanisms, including escalation paths for high-risk interactions." / "Where required or otherwise appropriate for your use case, using age assurance systems to ensure only intended users can access the product."
- "You should not use OpenAI services to process any personal data of children under 13 or the applicable age of digital consent without first implementing zero data retention in our API."
- "You are solely responsible for ensuring that you and your users use OpenAI services in compliance with applicable law." (COPPA 명시)
- "OpenAI reserves the right to audit organizations for compliance with this policy."

### OpenAI — Your data (API) (https://developers.openai.com/api/docs/guides/your-data)
- "data sent to the OpenAI API is not used to train or improve OpenAI models (unless you explicitly opt in to share data with us)."
- 남용 감시 로그: "retained for up to 30 days, unless longer retention is required by law" · 무보관(Zero Data Retention)은 사전 승인 시 가능.

> ※ openai.com/policies/usage-policies 본문은 자동 수집이 막혀(403) 위 개발자 가이드 페이지로 갈음. 보고서에 인용할 땐 개발자 가이드 URL을 쓰면 된다.

## 2. 요건 ↔ 「가지」 구현 ↔ 동의서 문구 대응표

| 두 회사 공통 요건 | 「가지」 구현(코드 근거) | 동의서·처리방침 문구 |
|---|---|---|
| 미성년자 제품은 **추가 안전장치** 구현 | 3층: ①교사 학급 설정 토글(기능별·기본 OFF)+킬스위치 ②서버 키워드 필터 8유형(욕설·성적·괴롭힘·개인정보·자해·혐오·잔혹·폭력극단+프롬프트 주입; 입력 전 차단, 원문 미로그) ③모델 지시(어린이 그림책·밝은 표현·거부 규칙) | 「교사 감독 아래에서만」「유해한 내용 차단」 |
| **연령 대응(age assurance)** — "intended users only" | 학생 개인 계정 없음. 교사가 만든 학급 코드+모둠 계정으로만 입장(자가 가입 차단·SELF-REG-BLOCK), 교사가 계정·PIN·잠금 관리 → 접근 주체가 교사가 등록한 학급 구성원으로 한정 | 「학급 코드와 모둠 이름만으로 참여」 |
| **모니터링·보고** | 팀별 사용 횟수·재생성 상한(모둠 24장·재생성 2회), 학급·전역 일일 상한, 안전 차단 로그(카테고리만), 교사 관리 화면에서 모둠별 사용 기록·나침반 답·AI 결과 열람 | 「사용량 제한과 기록」 |
| **AI 사용 고지**(AI와 상호작용 중임을 알림) | AI 결과에 「🎨 AI가 그린 그림」「AI 후보」 배지·「AI가 이야기를 만들고 있어요」 대기화면·환영 튜토리얼에 AI 역할 설명·1단계 인트로("AI가 글·그림을 만들어 줘요") | 「AI 도움의 양은 단계별로」+ 처리방침 6절 |
| **아동 개인정보를 AI로 보내지 말 것**(OpenAI: 13세 미만 개인정보는 ZDR 없이 처리 금지) | AI 호출 payload = 작품 본문·장면·구도 스케치만. 학생 이름·학년·반·얼굴 사진·PIN 미전송(모둠 계정도 이름 없음). 이미지 API엔 그림 데이터만 | 「AI로 보내는 것은 작품 내용뿐」 |
| **학습 미사용·소유권** | API 방식(두 회사 모두 API 입력·출력을 모델 학습에 쓰지 않음), 산출물 소유권은 고객(=학급/학생) | 「모델 학습에 사용되지 않는 API 방식」 |
| **법령 준수는 운영자 책임**(COPPA 등) | 한국: 개인정보보호법 제22조의2(만 14세 미만 아동 — 법정대리인 동의) → **보호자 동의서 ② 항목**이 그 절차. 학교는 교육활동 목적 최소 수집(이름·PIN 없음) | 동의서 ②·처리방침 전체 |
| **원본 보존·인간 검토** (Anthropic 고위험 지침의 "qualified professional review" 취지) | AI 결과는 원본과 분리 저장된 후보, 학생·교사가 비교 선택. 교사가 언제든 재생성·초기화 | 「아이의 원본은 그대로 보존」 |

## 3. 정직한 갭 — 보고서엔 "추가 예정"으로 적을 것
1. **Anthropic 아동안전 시스템 프롬프트**: Anthropic이 제공하는 child-safety system prompt를 "포괄적 안전조치의 일부로 구현해야(should)" 한다고 권고. 「가지」는 자체 어린이 지시문(어린이 그림책 톤·거부 규칙)을 쓰지만 Anthropic 제공 문구 그대로는 아님 → 적용 검토(요청 시 프롬프트 앞단에 삽입, 무배포 위험 낮음).
2. **OpenAI Zero Data Retention**: 개인정보를 보내지 않으므로 필수 조건은 충족하나, 남용 감시 로그 30일 보관은 남음. 사전 승인이 필요한 ZDR은 미신청 → "개인정보 미전송으로 대응, ZDR은 신청 검토"로 기재.
3. **에스컬레이션 경로**: 안전 차단은 자동(거부·로그)이며 교사에게 실시간 알림은 없음(교사 화면에서 사후 확인). 고위험 상호작용 자동 알림은 후속.
4. 두 회사 문서는 한국법을 직접 다루지 않음 → 보고서엔 "COPPA 등 각국 아동 보호법 준수 요구 → 한국 개인정보보호법(만 14세 미만 법정대리인 동의)에 따라 보호자 동의 절차 운영"으로 연결.

## 4. 보고서용 문단 (Ⅱ.5 「인공지능의 자리」 또는 Ⅴ.4 제언에 삽입)
> 생성형 AI 제공사인 Anthropic과 OpenAI는 미성년자가 이용하는 제품에 대해 API 활용을 금지하지 않고, 대신 운영자에게 연령 대응·콘텐츠 필터·모니터링·AI 사용 고지·아동 개인정보 보호법 준수를 요구한다(Anthropic 「Guidelines for Organizations Serving Minors」, OpenAI 「Under 18 API Guidance」). '가지'는 이 요건을 학교 상황에 맞게 구현하였다. 학생은 개인 계정 없이 교사가 등록한 학급 코드로 참여하고(연령 대응), 모든 요청은 서버를 거치며 폭력·성적 표현 등 8유형을 전송 전에 차단하고(필터), 기능별 교사 토글·사용량 상한·사용 기록(모니터링), AI 결과 배지와 대기화면(고지), 작품 내용 외 개인정보 미전송과 보호자 동의 절차(개인정보 보호)를 갖추었다. 두 제공사 모두 API로 전송된 자료를 모델 학습에 쓰지 않으며 산출물 권리는 이용자에게 귀속된다.

## 5. 출처
- https://www.anthropic.com/legal/aup
- https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors
- https://support.claude.com/en/articles/15591275-child-safety-guidance-for-developers
- https://www.anthropic.com/legal/commercial-terms
- https://developers.openai.com/api/docs/guides/safety-checks/under-18-api-guidance
- https://developers.openai.com/api/docs/guides/your-data
