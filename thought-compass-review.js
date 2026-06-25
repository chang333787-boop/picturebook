/* thought-compass-review.js — 최종 검토·완료 화면(브라우저 전용, Phase I).
   7개 핵심 답변(+후속) 세로 목록 → 고치기/완료. 완료 = 검증 후 markCompleted + 기본 장면 생성(Phase J 훅).
   순수 완료 판정은 thought-compass.js(validateThoughtCompassCompletion). */
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thought-compass-review';

  function _Q() { return window.ThoughtCompassQuestions; }
  function _Flow() { return window.ThoughtCompassFlow; }
  function _TC() { return window.ThoughtCompass; }
  function _Store() { return window.ThoughtCompassStore; }
  function _UI() { return window.ThoughtCompassUI; }

  let R = null;   /* { ctx, vm, followUps, busy, error } */

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _remove() { const o = document.getElementById(OVERLAY_ID); if (o && o.parentNode) o.parentNode.removeChild(o); }

  function open(ctx, vm, followUps) {
    R = { ctx: ctx, vm: vm, followUps: Array.isArray(followUps) ? followUps : [], busy: false, error: null, readOnly: false, userNotes: '' };
    _render();
    _hydrateUserNotes();   /* FREE-NOTE: 완료 화면 — 기존 메모(있으면) 비동기 로드 후 textarea 채움 */
  }
  /* FREE-NOTE: state.raw에서 자유 메모 텍스트 추출(없으면 ''). */
  function _userNotesText(state) {
    return (state && state.userNotes && typeof state.userNotes.text === 'string') ? state.userNotes.text : '';
  }
  /* FREE-NOTE: 완료 화면 진입 시 기존 메모 로드(질문 데이터 미접근). */
  async function _hydrateUserNotes() {
    if (!R || R.readOnly) return;
    const Store = _Store();
    if (!Store || typeof Store.loadThoughtCompassUserNotes !== 'function') return;
    try {
      const text = await Store.loadThoughtCompassUserNotes(R.ctx);
      if (R) {
        R.userNotes = text || '';
        const ta = document.querySelector('#' + OVERLAY_ID + ' .tc-note-input');
        if (ta && !ta.value) ta.value = R.userNotes;
      }
    } catch (_) {}
  }
  /* FREE-NOTE: 자유 메모만 저장(변화 없으면 write 생략). 성공 bool 반환. */
  async function _saveUserNotes(text) {
    const Store = _Store();
    if (!Store || typeof Store.saveThoughtCompassUserNotes !== 'function' || !R) return false;
    const next = (typeof text === 'string') ? text : '';
    if ((R.userNotes || '') === next) { R.userNotes = next; return true; }
    try {
      const res = await Store.saveThoughtCompassUserNotes(R.ctx, next);
      if (res && res.ok) { R.userNotes = next; return true; }
      return false;
    } catch (_) { return false; }
  }

  /* 완료된 생각 나침반 '다시 보기'(Phase L, D-17) — read-only. 원본 보존(D-16): 고치기/완료 없음.
     메모(다듬기 전용 300자, UX-15) + 브랜치/다듬기 서랍(WIRE-13/14)은 후속 단계로 보류. */
  async function openReadOnly(ctx) {
    const Store = _Store(), Q = _Q();
    let state = null;
    if (Store && typeof Store.loadThoughtCompassStateResult === 'function') {
      try { const r = await Store.loadThoughtCompassStateResult(ctx); state = r && r.raw; } catch (e) { state = null; }
    }
    state = state || {};
    const vm = { questions: Q ? Q.getCoreQuestions() : [], answers: (state.answers && typeof state.answers === 'object') ? state.answers : {} };
    R = { ctx: ctx, vm: vm, followUps: Array.isArray(state.followUps) ? state.followUps : [], busy: false, error: null, readOnly: true, userNotes: _userNotesText(state) };
    _render();
  }

  function _render() {
    if (!R) return;
    const Q = _Q(), Flow = _Flow();
    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '생각 나침반 최종 확인');
    const card = _el('div', 'tc-flow-card tc-review-card');

    const t = _el('h2', 'tc-flow-title', R.readOnly ? '내 생각 나침반' : '생각 나침반을 만들 준비가 되었어요'); t.id = 'tc-review-title';
    card.appendChild(t);
    overlay.setAttribute('aria-labelledby', 'tc-review-title');
    card.appendChild(_el('p', 'tc-flow-help', R.readOnly ? '우리가 정한 이야기 방향이에요.' : '정한 내용을 살펴보고, 고치고 싶은 게 있으면 “고치기”를 눌러요.'));
    /* FREE-NOTE: 참고 자료 안내 — 반드시 이대로 써야 한다는 인상 주지 않기. */
    card.appendChild(_el('p', 'tc-flow-help tc-flow-help--guide', '생각 나침반은 이야기를 시작하기 위한 참고 자료예요. 만들면서 새로운 생각이 떠오르면 자유롭게 바꾸어도 괜찮아요.'));

    const list = _el('div', 'tc-review-list');
    const questions = Q ? Q.getCoreQuestions() : R.vm.questions;
    questions.forEach((q, idx) => {
      const item = _el('div', 'tc-review-item');
      const head = _el('div', 'tc-review-q', q.title);
      item.appendChild(head);
      const a = R.vm.answers[q.id];
      const answerText = (a && a.answerText) ? a.answerText : '(아직 안 정함)';
      const ans = _el('div', 'tc-review-a' + ((a && a.answerText) ? '' : ' is-empty'), answerText);
      item.appendChild(ans);
      /* 이 질문의 후속답변 */
      const fus = R.followUps.filter(f => f && f.parentQuestionId === q.id);
      fus.forEach(f => {
        const sub = _el('div', 'tc-review-followup');
        sub.appendChild(_el('div', 'tc-review-fq', '↳ ' + (f.prompt || '')));
        sub.appendChild(_el('div', 'tc-review-fa', (f.answer || '')));
        item.appendChild(sub);
      });
      if (!R.readOnly) {
        const edit = _el('button', 'tc-review-edit', '고치기');
        edit.type = 'button';
        edit.addEventListener('click', function () { _editQuestion(idx); });
        item.appendChild(edit);
      }
      list.appendChild(item);
    });
    card.appendChild(list);

    /* FREE-NOTE: 질문과 분리된 자유 메모 — 완료 화면=입력(선택), 결과 패널=표시+메모만 수정.
       진행률·완료 판정·BASE10·AI와 무관. 질문 답변(읽기 전용)과 시각적으로 구분. */
    _appendNoteSection(card);

    if (R.error) {
      const err = _el('p', 'tc-flow-error', R.error);
      err.setAttribute('role', 'alert');
      card.appendChild(err);
    }
    if (R.busy) card.appendChild(_el('p', 'tc-flow-aistatus', '생각 나침반을 만들고 있어요…'));

    const nav = _el('div', 'tc-flow-nav');
    nav.appendChild(_el('span', 'tc-flow-nav-spacer'));
    if (R.readOnly) {
      const closeBtn = _el('button', 'tc-flow-next', '닫기');
      closeBtn.type = 'button';
      closeBtn.addEventListener('click', function () { close(); });
      nav.appendChild(closeBtn);
    } else {
      const done = _el('button', 'tc-flow-next', '이 생각으로 시작하기');
      done.type = 'button';
      done.disabled = R.busy;
      done.addEventListener('click', function () { _complete(); });
      nav.appendChild(done);
    }
    card.appendChild(nav);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try { t.setAttribute('tabindex', '-1'); t.focus(); } catch (e) {}
  }

  /* FREE-NOTE: 자유 메모 섹션 — 완료 화면=입력란(선택, blur 저장), 결과 패널=표시+[메모 수정]. */
  function _appendNoteSection(card) {
    const sec = _el('div', 'tc-note-section');
    if (!R.readOnly) {
      sec.appendChild(_el('div', 'tc-note-title', '📝 떠오른 생각 메모'));
      sec.appendChild(_el('p', 'tc-note-help', '질문에는 없었지만 기억해 두고 싶은 생각이 있나요? 인물·사건·장면·대사 등 무엇이든 자유롭게 적어 보세요. (안 적어도 괜찮아요.)'));
      const ta = _el('textarea', 'tc-note-input');
      ta.setAttribute('rows', '4');
      ta.setAttribute('maxlength', '2000');
      ta.setAttribute('aria-label', '떠오른 생각 메모 (선택)');
      ta.setAttribute('placeholder', '예: 주인공의 단짝 친구도 등장시키고 싶어요…');
      ta.value = R.userNotes || '';
      /* 기존 저장 UX(자동 저장)에 맞춰 blur 시 저장. 빈값도 허용. 진행률·완료엔 미반영. */
      ta.addEventListener('blur', function () { _saveUserNotes(ta.value); });
      sec.appendChild(ta);
    } else {
      sec.appendChild(_el('div', 'tc-note-title', '📝 내 자유 메모'));
      const text = R.userNotes || '';
      const view = _el('div', 'tc-note-view' + (text ? '' : ' is-empty'), text || '아직 적어 둔 메모가 없어요.');
      sec.appendChild(view);
      const editBtn = _el('button', 'tc-note-edit-btn', '메모 수정');
      editBtn.type = 'button';
      editBtn.addEventListener('click', function () { _openNoteEditor(sec, view, editBtn); });
      sec.appendChild(editBtn);
    }
    card.appendChild(sec);
  }
  /* FREE-NOTE: 결과 패널에서 메모만 수정(질문·답변·완료상태 불변, BASE10/AI 호출 없음). */
  function _openNoteEditor(sec, view, editBtn) {
    if (sec.querySelector('.tc-note-editor')) return;
    view.style.display = 'none';
    editBtn.style.display = 'none';
    const editor = _el('div', 'tc-note-editor');
    const ta = _el('textarea', 'tc-note-input');
    ta.setAttribute('rows', '4'); ta.setAttribute('maxlength', '2000');
    ta.setAttribute('aria-label', '자유 메모 수정');
    ta.value = R.userNotes || '';
    editor.appendChild(ta);
    const row = _el('div', 'tc-note-editor-actions');
    const save = _el('button', 'tc-note-save', '저장'); save.type = 'button';
    const cancel = _el('button', 'tc-note-cancel', '취소'); cancel.type = 'button';
    const cleanup = function () { editor.remove(); view.style.display = ''; editBtn.style.display = ''; };
    save.addEventListener('click', async function () {
      save.disabled = true; save.textContent = '저장 중…';
      const ok = await _saveUserNotes(ta.value);
      if (ok) {
        view.textContent = (ta.value || '아직 적어 둔 메모가 없어요.');
        view.classList.toggle('is-empty', !ta.value);
        cleanup();
      } else { save.disabled = false; save.textContent = '저장'; }
    });
    cancel.addEventListener('click', cleanup);
    row.appendChild(save); row.appendChild(cancel);
    editor.appendChild(row);
    sec.insertBefore(editor, editBtn);
    try { ta.focus(); } catch (e) {}
  }

  /* 고치기 — 해당 질문으로 이동해 단일 수정 후 검토로 복귀(D-09). 다른 답변 보존. */
  function _editQuestion(idx) {
    const UI = _UI();
    if (!UI || typeof UI.openForEdit !== 'function') return;
    _remove();
    UI.openForEdit(R.ctx, R.vm, idx, function (updatedVm) {
      if (updatedVm) R.vm = updatedVm;   /* 수정 반영(취소면 null → 기존 답 유지) */
      R.error = null;
      _render();                          /* 검토 화면 복귀 */
    });
  }

  async function _complete() {
    if (R.busy) return;
    /* FREE-NOTE: 완료 전 현재 메모 입력값 저장(busy 재렌더로 textarea 사라지기 전). 별도 필드라 완료/진행률과 무관. */
    const _noteTa = document.querySelector('#' + OVERLAY_ID + ' .tc-note-input');
    if (_noteTa) { try { await _saveUserNotes(_noteTa.value); } catch (_) {} }
    const TC = _TC(), Store = _Store(), Flow = _Flow();
    /* 완료 조건 — 7핵심 모두 유효(유예 답변 포함). */
    const state = { status: 'inProgress', answers: R.vm.answers, followUps: R.followUps, completedAt: null };
    const v = TC ? TC.validateThoughtCompassCompletion(state) : { valid: Flow.allAnswered(R.vm) };
    if (!v.valid) {
      R.error = '아직 정하지 않은 질문이 있어요. “고치기”로 채워 주세요.';
      _render();
      return;
    }
    R.busy = true; R.error = null; _render();

    let ok = true;
    try {
      if (Store && typeof Store.markThoughtCompassCompleted === 'function') {
        await Store.markThoughtCompassCompleted(R.ctx, state);
      }
    } catch (e) { ok = false; }
    if (!ok) {
      R.busy = false; R.error = '완료하지 못했어요. 다시 시도해 주세요.';
      _render();
      return;                 /* 저장 실패 → 완료 차단(maker 미진입) */
    }

    /* Phase J — 완료 후 기본 장면 생성(훅). 실패해도 완료/진입은 막지 않음. */
    try {
      if (typeof window.ThoughtCompassComplete !== 'undefined' && window.ThoughtCompassComplete
          && typeof window.ThoughtCompassComplete.afterComplete === 'function') {
        await window.ThoughtCompassComplete.afterComplete(R.ctx);
      }
    } catch (e) { /* noop — 장면 생성 실패는 maker에서 수동 생성 가능 */ }

    /* 게이트/검토 닫기 → maker 노출 */
    _remove();
    if (window.ThoughtCompassGate && typeof window.ThoughtCompassGate.closeGate === 'function') window.ThoughtCompassGate.closeGate();
    if (_UI() && typeof _UI().close === 'function') _UI().close();
    R = null;
  }

  function close() { _remove(); R = null; }

  window.ThoughtCompassReview = { open: open, openReadOnly: openReadOnly, close: close, _render: _render };
})();
