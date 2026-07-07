/* tutorial-print.js — P1 학생 사용설명서 · P2 교사 준비 가이드 인쇄 (TUTORIAL-PRD Phase C/D).
   window.TutorialPrint.printStudent() / printTeacher(). 정적 콘텐츠(팀 데이터 0)라 자체완결.
   입장카드 인쇄(_printEntryCards)와 동일 게이트 패턴: body 클래스 + 전용 root + 주입 @media print +
   afterprint 정리. DB write 0. TutorialContent.studentPrintSteps / teacherSteps 재사용(문구 단일소스). */
;(function () {
  'use strict';
  const ROOT_ID = 'tutorial-print-root';
  const STYLE_ID = 'tutorial-print-style';

  function _content() {
    return (typeof window !== 'undefined' && window.TutorialContent) ? window.TutorialContent : null;
  }
  function _esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function _cleanup() {
    document.body.classList.remove('tutorial-print-on');
    const r = document.getElementById(ROOT_ID);
    const s = document.getElementById(STYLE_ID);
    if (r) r.remove();
    if (s) s.remove();
    window.removeEventListener('afterprint', _cleanup);
  }

  function _stepsHtml(steps) {
    return (Array.isArray(steps) ? steps : []).map((st, i) => `
      <div class="tp-step">
        <div class="tp-num">${i + 1}</div>
        <div class="tp-icon">${_esc(st.icon)}</div>
        <div class="tp-body">
          <div class="tp-title">${_esc(st.title)}</div>
          <div class="tp-text">${_esc(st.text)}</div>
        </div>
      </div>`).join('');
  }

  function _art(id) { return (typeof window !== 'undefined' && window.TutorialArt) ? window.TutorialArt.get(id) : ''; }

  function _print(kind, docTitle, subtitle, steps, footNote, artId) {
    if (!Array.isArray(steps) || !steps.length) {
      try { alert('인쇄할 사용설명서 내용을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.'); } catch (e) {}
      return;
    }
    const prev = document.getElementById(ROOT_ID);
    if (prev) prev.remove();

    const hero = _art(artId);
    const root = document.createElement('div');
    root.id = ROOT_ID;
    root.innerHTML = `
      <div class="tp-page">
        <div class="tp-head">
          <div class="tp-brand">🌿 가지 — 함께 만드는 이야기</div>
          <div class="tp-doctitle">${_esc(docTitle)}</div>
          <div class="tp-subtitle">${_esc(subtitle)}</div>
          ${hero ? `<div class="tp-hero">${hero}</div>` : ''}
        </div>
        <div class="tp-steps">${_stepsHtml(steps)}</div>
        ${footNote ? `<div class="tp-foot">${_esc(footNote)}</div>` : ''}
      </div>`;
    document.body.appendChild(root);

    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} { display: none; }
      @media print {
        body.tutorial-print-on > *:not(#${ROOT_ID}) { display: none !important; }
        body.tutorial-print-on #${ROOT_ID} { display: block; }
        #${ROOT_ID} { color: #2b1f10; font-family: 'Jua','Nanum Gothic',sans-serif; }
        .tp-page { padding: 10mm 12mm; }
        .tp-head { text-align: center; margin-bottom: 8mm; }
        .tp-brand { font-size: 11pt; color: #6b5638; }
        .tp-doctitle { font-size: 22pt; font-weight: 800; margin: 3mm 0 1mm; }
        .tp-subtitle { font-size: 12pt; color: #7a6a50; }
        .tp-hero { max-width: 88mm; margin: 4mm auto 0; }
        .tp-hero svg { width: 100%; height: auto; }
        .tp-steps { display: grid; grid-template-columns: 1fr; gap: 5mm; }
        .tp-step { display: flex; align-items: flex-start; gap: 5mm; break-inside: avoid;
                   border: 1.5px solid #e6d6ba; border-radius: 10px; padding: 5mm 6mm; }
        .tp-num { flex: 0 0 auto; width: 9mm; height: 9mm; border-radius: 50%; background: #c66f4a;
                  color: #fff; font-weight: 800; font-size: 13pt; display: flex; align-items: center; justify-content: center; }
        .tp-icon { flex: 0 0 auto; font-size: 22pt; width: 12mm; text-align: center; }
        .tp-body { flex: 1 1 auto; }
        .tp-title { font-size: 15pt; font-weight: 700; margin-bottom: 1mm; }
        .tp-text { font-size: 12.5pt; color: #4a3d28; line-height: 1.5; }
        .tp-foot { margin-top: 7mm; font-size: 11pt; color: #7a6a50; text-align: center;
                   border-top: 1px dashed #cbb994; padding-top: 4mm; }
      }`;
    document.head.appendChild(style);

    try {
      document.body.classList.add('tutorial-print-on');
      window.addEventListener('afterprint', _cleanup);
      window.print();
      setTimeout(_cleanup, 2000);   /* afterprint 미발화 브라우저 방어 */
    } catch (e) { _cleanup(); }
  }

  function printStudent() {
    const C = _content();
    _print('student', '작품 만들기 사용법', '이 순서대로 하면 나만의 이야기를 만들 수 있어요',
      C && C.studentPrintSteps, '궁금하면 화면 위쪽 ❓ 버튼을 눌러 사용법을 다시 볼 수 있어요.', 'branch');
  }
  function printTeacher() {
    const C = _content();
    _print('teacher', '교사 준비 가이드', '수업 전 이 순서로 준비하면 돼요',
      C && C.teacherSteps, '학생 배부용 사용법은 [사용설명서(학생) 인쇄]로 뽑아 나눠 주세요.', 'compass');
  }

  if (typeof window !== 'undefined') {
    window.TutorialPrint = { printStudent: printStudent, printTeacher: printTeacher };
  }
})();
