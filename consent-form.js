/* ════════════════════════════════════════════════════════════════
   consent-form.js — CONSENT-FORM-3(2026-09-06): 가정 배부용 「개인정보 수집·이용 및 생성형 AI 활용 동의서」 단일 출처.
   ─────────────────────────────────────────────────────────────────
   · 왜: 교사 관리(adminConsole 인쇄)와 심사위원 교사 화면(consent.html 미리보기) 두 곳에서 같은 서식을 쓰므로
     HTML·인쇄 CSS를 한 파일로 뺐다(문구 두 벌 관리 방지). 내용은 CONSENT-FORM-1/2와 동일.
   · window.ConsentForm.html()      → 서식 본문(HTML 문자열)
   · window.ConsentForm.printCss(rootId) → @media print 규칙(rootId 요소만 A4 세로 1장으로 인쇄)
   · 학교명·교사명은 빈칸(블라인드·학교마다 다름). 개인정보 미수집 원칙 안내 포함.
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function html() {
    const row = (label, hint) => `
      <tr><th>${esc(label)}</th><td>${hint ? `<span class="cf-hint">${esc(hint)}</span>` : ''}</td></tr>`;
    const check = (t) => `<span class="cf-chk">☐</span> ${esc(t)}`;
    return `
    <div class="cf-doc">
      <div class="cf-head">
        <div class="cf-school">학교명 <span class="cf-line cf-line--sm"></span> · 학년/반 <span class="cf-line cf-line--xs"></span></div>
        <h1 class="cf-title">개인정보 수집·이용 및 생성형 AI 활용 동의서</h1>
        <div class="cf-sub">이야기 창작 수업(가지 branch) 운영과 수업 중 생성형 인공지능(AI) 활용에 대해 보호자님의 동의를 받고자 합니다.</div>
      </div>
  
      <div class="cf-notice">
        <b>먼저 알려드립니다.</b> 수업에 사용하는 프로그램(가지 branch)은 <b>학생의 이름·연락처 등
        개인정보를 수집하지 않습니다.</b> 모둠 이름과 숫자 PIN만으로 이용하며, 작품은 학급 안에서만 봅니다.
        아래 항목은 <b>담임교사가 학급 운영·기록을 위해 따로 모으는 경우</b>에만 해당합니다.
      </div>
  
      <table class="cf-table">
        <tr><th>수집·이용 목적</th><td>학급 이야기 창작 활동의 지도·기록 및 학급 작품집 제작</td></tr>
        <tr><th>수집 항목</th><td class="cf-checks">
          ${check('학생 이름')} ${check('학년·반·번호')} ${check('보호자 연락처')}<br/>
          ${check('학생이 만든 작품(글·그림)')} ${check('수업 활동 사진')} ${check('활동 영상')}<br/>
          ${check('기타: ')}<span class="cf-line cf-line--md"></span>
        </td></tr>
        <tr><th>보유·이용 기간</th><td>해당 학년도 종료 시까지 보관한 뒤 파기합니다.</td></tr>
        <tr><th>제3자 제공</th><td>제공하지 않습니다.</td></tr>
      </table>
  
      <div class="cf-ai">
        <div class="cf-ai-title">수업에서 생성형 AI를 이렇게 사용합니다</div>
        <div class="cf-ai-lead">프로그램의 AI는 이야기를 대신 만드는 것이 아니라, 아이가 세운 이야기 위에서 표현을 돕는 조력자로만 쓰입니다.</div>
        <ul class="cf-ai-list">
          <li><b>교사 감독 아래에서만</b> — AI 기능(초안 돕기·글 다듬기·그림 완성·작품 점검)은 담임교사가 항목별로 켠 것만 쓸 수 있고 기본값은 모두 꺼짐입니다. 교사는 학급 전체 AI를 언제든 중지할 수 있습니다.</li>
          <li><b>아이가 AI에 직접 접속하지 않음</b> — 학생은 AI 회사 서비스에 접속하거나 계정을 만들지 않습니다. 모든 요청은 프로그램 서버를 거치며, 학급 코드와 모둠 이름만으로 참여합니다.</li>
          <li><b>AI로 보내는 것은 작품 내용뿐</b> — 이야기 글과 그림(구도 스케치)만 전달되고 학생 이름·학년·반·사진 등 개인정보는 전달하지 않습니다. 전달 내용은 모델 학습에 쓰이지 않는 API 방식으로 처리됩니다.</li>
          <li><b>유해한 내용 차단</b> — 폭력·잔혹, 성적 표현, 욕설, 괴롭힘·혐오, 자해, 개인정보 노출 등은 프로그램이 먼저 걸러 AI에 보내지 않고, AI 결과도 같은 기준으로 다시 확인합니다.</li>
          <li><b>아이의 원본은 그대로 보존</b> — AI가 다듬은 글·그림은 원본과 따로 저장된 후보이며, 아이와 교사가 비교해 고릅니다. AI가 원본을 덮어쓰지 않습니다.</li>
          <li><b>사용량 제한과 기록</b> — 모둠별·학급별 사용 상한이 있고 교사가 사용 기록을 확인합니다. AI 도움의 양은 1단계→3단계로 갈수록 줄어들어, 목표는 AI 없이도 이야기를 구성하는 힘을 기르는 것입니다.</li>
        </ul>
        <div class="cf-ai-note">사용한 AI: 글 — Anthropic Claude API · 그림 — OpenAI 이미지 API (모두 서버 경유, 학생 직접 접속 없음)</div>
      </div>
  
      <div class="cf-right">
        <b>동의를 거부할 권리가 있습니다.</b> 동의하지 않아도 수업 참여나 평가에는 아무런 불이익이 없습니다.
        동의하지 않은 항목은 위 목적에 사용되지 않으며, AI 기능 없이도 같은 수업에 참여할 수 있습니다.
      </div>
  
      <div class="cf-agree">
        <div class="cf-agree-row">
          <span class="cf-agree-label">① 개인정보 수집·이용에</span>
          <span class="cf-big">☐ 동의합니다</span>
          <span class="cf-big">☐ 동의하지 않습니다</span>
        </div>
        <div class="cf-agree-row">
          <span class="cf-agree-label">② 교사 감독 아래 생성형 AI 사용에</span>
          <span class="cf-big">☐ 동의합니다</span>
          <span class="cf-big">☐ 동의하지 않습니다</span>
        </div>
      </div>
  
      <table class="cf-sign">
        <tr>
          <th>학생 이름</th><td><span class="cf-line cf-line--md"></span></td>
          <th>날짜</th><td>20&nbsp;&nbsp;&nbsp;&nbsp;년&nbsp;&nbsp;&nbsp;&nbsp;월&nbsp;&nbsp;&nbsp;&nbsp;일</td>
        </tr>
        <tr>
          <th>보호자 성명</th><td><span class="cf-line cf-line--md"></span></td>
          <th>서명</th><td><span class="cf-line cf-line--md"></span> (인)</td>
        </tr>
      </table>
  
      <div class="cf-foot">
        이 동의서는 담임교사가 보관합니다. 문의: 담임교사
      </div>
    </div>`;
  }

  function printCss(ROOT_ID) {
    return `
    #${ROOT_ID} { display:none; }
    @media print {
      @page { size: A4 portrait; margin: 14mm 15mm; }
      body.cf-print-on > *:not(#${ROOT_ID}) { display:none !important; }
      body.cf-print-on #${ROOT_ID} { display:block; }
      #${ROOT_ID} .cf-doc { color:#111; font-family:'Nanum Gothic','Malgun Gothic',sans-serif;
        font-size:9.6pt; line-height:1.5; word-break:keep-all; }
      #${ROOT_ID} .cf-head { text-align:center; margin:0 0 4mm; }
      #${ROOT_ID} .cf-school { font-size:9.5pt; color:#444; margin:0 0 3mm; text-align:right; }
      #${ROOT_ID} .cf-title { font-size:17pt; font-weight:700; margin:0 0 1.5mm; letter-spacing:.01em; }
      #${ROOT_ID} .cf-sub { font-size:10pt; color:#333; }
      #${ROOT_ID} .cf-notice { border:1px solid #999; background:#f6f6f6; padding:2.8mm 3.5mm;
        margin:0 0 3.5mm; font-size:9.2pt; }
      #${ROOT_ID} .cf-table, #${ROOT_ID} .cf-sign { width:100%; border-collapse:collapse; margin:0 0 3.5mm; }
      #${ROOT_ID} .cf-table th, #${ROOT_ID} .cf-table td,
      #${ROOT_ID} .cf-sign th, #${ROOT_ID} .cf-sign td { border:1px solid #666; padding:2mm 3mm; vertical-align:top; }
      #${ROOT_ID} .cf-table th, #${ROOT_ID} .cf-sign th { width:26mm; background:#efefef; font-weight:700; white-space:nowrap; }
      #${ROOT_ID} .cf-sign th { width:22mm; }
      #${ROOT_ID} .cf-checks { line-height:1.9; }
      #${ROOT_ID} .cf-ai { border:1px solid #999; padding:2.8mm 3.5mm; margin:0 0 3.5mm; }
      #${ROOT_ID} .cf-ai-title { font-size:10.5pt; font-weight:700; margin:0 0 1mm; }
      #${ROOT_ID} .cf-ai-lead { font-size:9pt; color:#333; margin:0 0 1.5mm; }
      #${ROOT_ID} .cf-ai-list { margin:0; padding-left:4.5mm; font-size:8.9pt; line-height:1.45; }
      #${ROOT_ID} .cf-ai-list li { margin:0 0 0.8mm; }
      #${ROOT_ID} .cf-ai-note { font-size:8.6pt; color:#444; margin-top:1.5mm; }
      #${ROOT_ID} .cf-chk { font-size:12pt; }
      #${ROOT_ID} .cf-hint { color:#666; font-size:9pt; }
      #${ROOT_ID} .cf-line { display:inline-block; border-bottom:1px solid #333; vertical-align:baseline; }
      #${ROOT_ID} .cf-line--xs { width:16mm; } #${ROOT_ID} .cf-line--sm { width:32mm; }
      #${ROOT_ID} .cf-line--md { width:42mm; } #${ROOT_ID} .cf-line--lg { width:70mm; }
      #${ROOT_ID} .cf-right { font-size:9.2pt; margin:0 0 3.5mm; }
      #${ROOT_ID} .cf-agree { border:1.6px solid #333; padding:2.5mm 3mm; margin:0 0 3.5mm; }
      #${ROOT_ID} .cf-agree-row { display:flex; align-items:center; flex-wrap:wrap; gap:0 3mm; padding:1mm 0; }
      #${ROOT_ID} .cf-agree-row + .cf-agree-row { border-top:1px dashed #999; }
      #${ROOT_ID} .cf-agree-label { flex:1 1 auto; font-weight:700; }
      #${ROOT_ID} .cf-big { font-size:11.5pt; font-weight:700; margin:0 2mm; white-space:nowrap; }
      #${ROOT_ID} .cf-foot { font-size:8.8pt; color:#444; text-align:center; margin-top:3mm; }
    }`;
  }
  window.ConsentForm = { html: html, printCss: printCss };
})();
