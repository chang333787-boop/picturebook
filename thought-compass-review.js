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
    const Store = _Store(), Q = _Q(), TC = _TC();
    let state = null, loadErr = null;
    if (Store && typeof Store.loadThoughtCompassStateResult === 'function') {
      try {
        const r = await Store.loadThoughtCompassStateResult(ctx);
        state = r && r.raw;
        if (r && r.ok === false) loadErr = r.errorCode || null;
      } catch (e) { state = null; loadErr = (e && e.code) ? String(e.code) : null; }
    }
    state = state || {};
    /* V2: 저장 데이터 기준 질문 세트 선택(v1 완료본은 v1 그대로 표시 — 하위호환). */
    /* MODE-REGRESS-GUARD(2026-07-16): foundation 미로드 폴백을 옛(1)→최신(2)로. 정상 로드 시 무영향. */
    const qVersion = (TC && typeof TC.resolveQuestionSetVersion === 'function') ? TC.resolveQuestionSetVersion(state) : 2;
    const vm = { questions: Q ? Q.getCoreQuestions(qVersion) : [], answers: (state.answers && typeof state.answers === 'object') ? state.answers : {} };
    R = { ctx: ctx, vm: vm, followUps: Array.isArray(state.followUps) ? state.followUps : [], busy: false, error: null, readOnly: true, userNotes: _userNotesText(state) };
    /* LEGACY-MEMBERSHIP-UX-1: 권한 거부(멤버십 오래됨)면 빈 화면 대신 재입장 안내.
       교사(fromAdmin)는 teacher_uid로 read 가능해 이 분기에 오지 않음(=학생 stale uid 전용).
       그냥 데이터 없음(ok:true·raw null)이면 loadErr 없음 → 기존 빈 결과 화면 유지. */
    if (!ctx.fromAdmin && /PERMISSION_DENIED/i.test(String(loadErr || ''))) {
      R.error = '이 모둠은 입장 정보가 오래됐어요. 🌿 작품 만들기에서 모둠 이름과 비밀번호(PIN)로 다시 들어오면 결과를 볼 수 있어요.';
    }
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

    /* COMPASS-SHEET-1: v2면 "내 이야기 큰줄기 설계도" — 템플릿 줄거리+핵심 카드+인쇄.
       v1 결과보기는 기존 그대로(하위호환 — 설계도 미노출). 렌더 시 파생 계산(DB 저장 없음). */
    _appendSheetSection(card);

    const list = _el('div', 'tc-review-list');
    /* V2: vm이 실은 질문 세트가 정본(버전 일치 보장). 없을 때만 v1 fallback. */
    const questions = (R.vm && Array.isArray(R.vm.questions) && R.vm.questions.length)
      ? R.vm.questions : (Q ? Q.getCoreQuestions() : []);
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

  /* ── COMPASS-SHEET-1: 내 이야기 큰줄기 설계도(v2 전용) ──
     · ThoughtCompassSheet(순수 helper)로 answers→storyMapV2 파생(렌더 시 계산·저장 없음)
     · 한 문단 줄거리(템플릿·AI 0) + 핵심 카드 10개 + 인쇄(1장 결과지)
     · 인쇄: body.tc-print-sheet 클래스를 인쇄 동안만 부여 → @media print에서 설계도만 출력.
       버튼 경유가 아니면(일반 Cmd+P) 클래스가 없어 일반 화면/인쇄 영향 0. */
  function _appendSheetSection(card) {
    const Sheet = window.ThoughtCompassSheet;
    if (!Sheet || typeof Sheet.buildStoryMapV2 !== 'function') return;                 /* 미로드 → 기존 화면 그대로 */
    if (!Sheet.isV2Questions(R.vm && R.vm.questions)) return;                          /* v1 → 미노출(하위호환) */
    const map = Sheet.buildStoryMapV2(R.vm.answers);

    const sec = _el('div', 'tc-sheet');
    const head = _el('div', 'tc-sheet-head');
    head.appendChild(_el('div', 'tc-sheet-title', '🧭 내 이야기 큰줄기 설계도'));
    const headBtns = _el('div', 'tc-sheet-head-btns');
    /* COMPASS-ROSE-1: 나침반형 보기·인쇄 — 카드형은 모바일 정본(≤600px에서 버튼 CSS 숨김)·v1 미노출.
       COMPASS-ROSE-DEFAULT(2026-07-11 사용자): 완료 확인 단계에도 노출 + 넓은 화면에선
       나침반형을 기본으로 자동 1회 오픈(닫으면 카드형·고치기 흐름 그대로). */
    if (window.ThoughtCompassRose && typeof window.ThoughtCompassRose.open === 'function') {
      const roseBtn = _el('button', 'tc-sheet-print-btn tc-sheet-rose-btn', '🧭 나침반형');
      roseBtn.type = 'button';
      roseBtn.title = '나침반 모양 설계도로 보고 인쇄해요 (태블릿 가로·인쇄용)';
      roseBtn.addEventListener('click', function () {
        /* TEACHER-PRINT-ROUTE-1: fromAdmin(관리모드 진입)을 rose에 전달 — 인쇄 버튼 직행 여부.
           ROSE-FIRST: 결과보기(readOnly)에선 여기서 열어도 닫기 한 번=전체 복귀 원칙 유지.
           완료 확인 단계는 훅 없이 — rose 닫으면 확인·고치기 화면으로 돌아옴(필수 흐름). */
        window.ThoughtCompassRose.open({
          map: map, memo: R.userNotes || '', fromAdmin: _isFromAdmin(),
          onClose: R.readOnly ? close : undefined,
          onSheetView: R.readOnly ? function () {} : undefined,
        });
      });
      headBtns.appendChild(roseBtn);
      /* ROSE-FIRST(2026-07-12): 결과보기(readOnly)는 나침반형이 기본 화면 —
         ✕ 닫기 한 번에 리뷰 전체가 닫히고(브랜치/다듬기로 복귀), 줄글(카드) 보기는
         rose 안 [📄 줄글로 보기]로 진입(그 화면 닫기도 한 번=전체 닫힘).
         완료 확인 단계(readOnly=false)는 고치기·완료 흐름이 있어 자동 오픈하지 않음(버튼만). */
      if (R.readOnly && !R._roseAutoOpened && !_isFromAdmin() && window.innerWidth > 600) {
        R._roseAutoOpened = true;
        setTimeout(function () {
          try {
            window.ThoughtCompassRose.open({
              map: map, memo: R.userNotes || '', fromAdmin: false,
              onClose: close,               /* 한 번에 화면 복귀 */
              onSheetView: function () {},  /* rose만 닫혀 아래 줄글 화면이 드러남 */
            });
          } catch (e) { /* noop */ }
        }, 120);
      }
    }
    /* TEACHER-PRINT-ROUTE-1: 학생 태블릿엔 프린터가 없어 기본은 "선생님께 부탁" 안내.
       관리모드(fromAdmin) 진입 시엔 기존 그대로 바로 인쇄. 보조 버튼으로 기기 인쇄 유지. */
    const printBtn = _el('button', 'tc-sheet-print-btn',
      _isFromAdmin() ? '🖨 인쇄하기' : '🖨 선생님께 인쇄 부탁하기');
    printBtn.type = 'button';
    printBtn.title = _isFromAdmin() ? '설계도를 1장으로 인쇄해요' : '이 설계도는 선생님 컴퓨터에서 종이로 뽑아요';
    printBtn.addEventListener('click', function () {
      if (_isFromAdmin()) { _printSheet(); return; }
      _showTeacherPrintNotice('설계도', _printSheet);
    });
    headBtns.appendChild(printBtn);
    head.appendChild(headBtns);
    sec.appendChild(head);

    /* 한 문단 줄거리(진엔딩까지 시간축) */
    sec.appendChild(_el('p', 'tc-sheet-summary', map.summaryText));

    /* 핵심 카드 10개 — 질문 순서(재료→한줄기→분기→앵커) */
    const grid = _el('div', 'tc-sheet-grid');
    map.fields.forEach(f => {
      const cardEl = _el('div', 'tc-sheet-card' + (f.deferred || !f.text ? ' is-deferred' : ''));
      cardEl.appendChild(_el('div', 'tc-sheet-card-label', f.icon + ' ' + f.label));
      cardEl.appendChild(_el('div', 'tc-sheet-card-value', f.text || Sheet.DEFERRED_LABEL));
      grid.appendChild(cardEl);
    });
    sec.appendChild(grid);
    if (map.deferredKeys.length) {
      sec.appendChild(_el('p', 'tc-sheet-defer-hint', '“' + Sheet.DEFERRED_LABEL + '” 칸은 이야기를 만들면서 채워 가요.'));
    }
    card.appendChild(sec);
  }
  /* TEACHER-PRINT-ROUTE-1: 관리모드 진입 여부 — openReadOnly ctx.fromAdmin. */
  function _isFromAdmin() { return !!(R && R.ctx && R.ctx.fromAdmin); }

  /* TEACHER-PRINT-ROUTE-1: "선생님께 인쇄 부탁하기" 안내 모달(viewer-ai와 동일 문구·독립 DOM).
     보조 버튼으로 이 기기 인쇄(AirPrint 교실) 유지. 저장 0. */
  function _showTeacherPrintNotice(label, onDevicePrint) {
    const prev = document.getElementById('tc-teacher-print-notice');
    if (prev) prev.remove();
    const root = _el('div', '');
    root.id = 'tc-teacher-print-notice';
    root.style.cssText = 'position:fixed;inset:0;z-index:10060;display:flex;align-items:center;justify-content:center;background:rgba(20,14,8,0.45);';
    const card = _el('div', '');
    card.style.cssText = 'background:#fffdf7;border-radius:14px;max-width:340px;width:calc(100% - 48px);padding:22px 20px 16px;box-shadow:0 12px 36px rgba(0,0,0,0.25);text-align:center;';
    card.innerHTML = ''
      + '<div style="font-size:30px;line-height:1;">🖨</div>'
      + '<div style="font-weight:700;font-size:16px;margin-top:8px;">선생님께 인쇄를 부탁해요</div>'
      + '<div style="font-size:13.5px;color:#5b4a33;margin-top:8px;line-height:1.55;">'
      +   (label || '이 자료') + '는 선생님 컴퓨터에서 종이로 뽑아요.<br>'
      +   '선생님께 <b>“인쇄해 주세요”</b>라고 말씀드려요!'
      + '</div>'
      + '<button type="button" class="tc-btn js-tpn-ok" style="margin-top:14px;width:100%;">알겠어요</button>'
      + '<button type="button" class="tc-btn js-tpn-device" style="margin-top:8px;width:100%;font-size:12px;opacity:0.75;">그래도 이 기기에서 인쇄해 보기</button>';
    root.appendChild(card);
    document.body.appendChild(root);
    const close = function () { root.remove(); };
    card.querySelector('.js-tpn-ok').addEventListener('click', close);
    card.querySelector('.js-tpn-device').addEventListener('click', function () {
      close();
      if (typeof onDevicePrint === 'function') { try { onDevicePrint(); } catch (e) { /* noop */ } }
    });
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
  }

  /* 설계도만 1장 인쇄 — 인쇄 동안만 body 클래스 부여(일반 화면 영향 0). */
  function _printSheet() {
    try {
      document.body.classList.add('tc-print-sheet');
      const cleanup = function () { document.body.classList.remove('tc-print-sheet'); window.removeEventListener('afterprint', cleanup); };
      window.addEventListener('afterprint', cleanup);
      window.print();
      /* afterprint 미발화 브라우저 방어(사파리 일부) — 지연 제거 */
      setTimeout(cleanup, 2000);
    } catch (e) { document.body.classList.remove('tc-print-sheet'); }
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

  /* ════ COMPASS-VALUE-1(2026-07-21 사용자 결정): 1단계 마지막 질문 — 가치 3택1 ════
     · 대상: picturebook 1단계만. AI(compassValueCandidates)가 나침반 답을 분석해 후보 3개
       제안(매번 다름·고정 보기 아님) → 아이가 1개 선택.
     · 실패/미배포/권한 = null 반환(단계 생략·완료 차단 금지 — fail-open).
     · 결과는 R._storyValue 캐시(완료 재시도 시 재호출/재질문 방지) + preWriting/storyValue 저장. */
  function _needsStoryValueStep() {
    try {
      if (!R || !R.ctx || R.ctx.projectType !== 'picturebook') return false;
      /* COMPASS-VALUE-ALL-LEVELS(2026-07-22 사용자 결정): 1단계뿐 아니라 2·3단계도 마지막에
         '이 이야기로 말하고 싶은 가치' 3택1. 1·2단계는 값이 초안 digest로 흘러가고, 3단계는
         AI 초안이 없어 preWriting/storyValue에 저장(반영·회고). 모든 그림책 단계 공통. */
      const lvl = (typeof window.getPicturebookLevel === 'function') ? window.getPicturebookLevel() : null;
      return lvl === 1 || lvl === 2 || lvl === 3;
    } catch (e) { return false; }
  }
  async function _runStoryValueStep() {
    if (R._storyValue) return R._storyValue;
    var digestFn = (typeof window._storyDraftAnswersDigest === 'function') ? window._storyDraftAnswersDigest
      : (typeof _storyDraftAnswersDigest === 'function' ? _storyDraftAnswersDigest : null);
    var answersText = '';
    try { answersText = digestFn ? digestFn(R.vm.answers) : ''; } catch (e) { answersText = ''; }
    if (!answersText) return null;

    /* 로딩 오버레이 */
    var ov = document.createElement('div');
    ov.id = 'tc-value-step';
    ov.style.cssText = 'position:fixed;inset:0;z-index:100040;display:flex;align-items:center;justify-content:center;background:rgba(40,32,20,.55);padding:16px;';
    ov.innerHTML = '<div style="background:#fffaee;border-radius:18px;max-width:460px;width:100%;padding:26px 24px;box-shadow:0 18px 50px rgba(43,31,16,.28);font-family:\'Jua\',\'Nanum Gothic\',sans-serif;color:#3a2a1a;text-align:center;">'
      + '<div style="font-size:34px;line-height:1;">🧭</div>'
      + '<div style="font-size:17px;font-weight:700;margin:8px 0 6px;">마지막 질문이에요</div>'
      + '<div class="tcv-body" style="font-size:14px;color:#6b5638;line-height:1.6;">나침반 답을 읽고 어울리는 가치를 고르고 있어요…</div>'
      + '</div>';
    document.body.appendChild(ov);

    var values = null;
    try {
      var res = await firebase.app().functions('asia-northeast3')
        .httpsCallable('compassValueCandidates', { timeout: 30000 })({
          classId: R.ctx.classId, teamName: R.ctx.teamName, answersText: answersText,
        });
      if (res && res.data && res.data.ok === true && Array.isArray(res.data.values) && res.data.values.length === 3) {
        values = res.data.values;
      }
    } catch (e) { values = null; }
    if (!values) { ov.remove(); return null; }   /* 후보 실패 → 단계 생략 */

    /* 선택 UI — 3 후보 카드 + 확정 버튼 */
    var picked = await new Promise(function (resolve) {
      var esc = function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
      var cards = values.map(function (v, i) {
        return '<button type="button" class="tcv-card" data-i="' + i + '" style="display:block;width:100%;text-align:left;'
          + 'background:#fdf6e6;border:2px solid #e8dcc4;border-radius:14px;padding:12px 14px;margin:8px 0;cursor:pointer;font-family:inherit;">'
          + '<div style="font-size:17px;font-weight:700;color:#4a3a22;">' + esc(v.word) + '</div>'
          + (v.hint ? '<div style="font-size:12.5px;color:#8a7a5e;margin-top:3px;line-height:1.5;">' + esc(v.hint) + '</div>' : '')
          + '</button>';
      }).join('');
      ov.firstElementChild.innerHTML = ''
        + '<div style="font-size:34px;line-height:1;">🧭</div>'
        + '<div style="font-size:17px;font-weight:700;margin:8px 0 2px;">마지막 질문이에요</div>'
        + '<div style="font-size:15px;color:#4a3a22;margin-bottom:4px;">이 이야기를 통해 말하고 싶은 가치는 무엇인가요?</div>'
        + '<div style="font-size:12px;color:#8a7a5e;margin-bottom:8px;">AI가 내 나침반 답을 읽고 어울리는 가치를 골라 봤어요. 하나를 골라 주세요.</div>'
        + cards
        + '<button type="button" class="tcv-ok" disabled style="margin-top:10px;min-width:160px;padding:11px 20px;border:none;border-radius:12px;'
        +   'background:#e5d9c2;color:#9a8a6e;font-family:inherit;font-size:15px;font-weight:700;cursor:default;">이걸로 정했어요</button>';
      var sel = -1;
      var okBtn = ov.querySelector('.tcv-ok');
      ov.querySelectorAll('.tcv-card').forEach(function (btn) {
        btn.addEventListener('click', function () {
          sel = parseInt(btn.dataset.i, 10);
          ov.querySelectorAll('.tcv-card').forEach(function (b) {
            b.style.borderColor = '#e8dcc4'; b.style.background = '#fdf6e6';
          });
          btn.style.borderColor = '#c66f4a'; btn.style.background = '#fff3e2';
          okBtn.disabled = false;
          okBtn.style.background = '#c66f4a'; okBtn.style.color = '#fffaee'; okBtn.style.cursor = 'pointer';
        });
      });
      okBtn.addEventListener('click', function () {
        if (okBtn.disabled || sel < 0) return;
        resolve(values[sel]);
      });
    });
    ov.remove();
    var out = { picked: picked.word, candidates: values };
    R._storyValue = out;
    /* 나침반 기록에 저장(별도 필드·실패해도 진행) */
    try {
      var Store = _Store();
      if (Store && typeof Store.saveThoughtCompassStoryValue === 'function') {
        await Store.saveThoughtCompassStoryValue(R.ctx, out.picked, out.candidates);
      }
    } catch (e) { /* noop */ }
    return out;
  }

  async function _complete() {
    if (R.busy) return;
    /* FREE-NOTE: 완료 전 현재 메모 입력값 저장(busy 재렌더로 textarea 사라지기 전). 별도 필드라 완료/진행률과 무관. */
    const _noteTa = document.querySelector('#' + OVERLAY_ID + ' .tc-note-input');
    if (_noteTa) { try { await _saveUserNotes(_noteTa.value); } catch (_) {} }
    const TC = _TC(), Store = _Store(), Flow = _Flow();
    /* 완료 조건 — 핵심 전부 유효(유예 포함). vm 질문 세트로 version 파생(완주 판정+완료 스탬프).
       LEVELS-CONT: easy(heroWho)=3·linear(protagonistName)=4를 명시 파생 — 종전엔 1로 스탬프돼
       resolve의 답 기반 자가복구에 기대던 것 정정(특히 linear는 targetLength 제거로 v2 오인 불가).
       EASY-MUSTINC: easy2(mustInclude)=5를 heroWho(easy)보다 먼저 — easy2 세트엔 heroWho도
       있어서 순서가 바뀌면 3으로 오파생(완료 스탬프·재편집 세트가 8문항으로 회귀). */
    const qVersion = (R.vm && Array.isArray(R.vm.questions))
      ? (R.vm.questions.some(function (q) { return q && q.id === 'mustInclude'; }) ? 5
        : (R.vm.questions.some(function (q) { return q && q.id === 'heroWho'; }) ? 3
          : (R.vm.questions.some(function (q) { return q && q.id === 'protagonistName'; }) ? 4
            : (R.vm.questions.some(function (q) { return q && q.id === 'targetLength'; }) ? 2 : 1))))
      : 1;
    const state = { version: qVersion, status: 'inProgress', answers: R.vm.answers, followUps: R.followUps, completedAt: null };
    const v = TC ? TC.validateThoughtCompassCompletion(state) : { valid: Flow.allAnswered(R.vm) };
    if (!v.valid) {
      R.error = '아직 정하지 않은 질문이 있어요. “고치기”로 채워 주세요.';
      _render();
      return;
    }
    /* COMPASS-VALUE-1: 1단계 마지막 질문(가치 3택1) — 유효성 통과 후·완료 저장 전.
       실패=단계 생략(fail-open)·선택 결과는 R._storyValue 캐시(재시도 시 재질문 없음). */
    if (_needsStoryValueStep() && !R._storyValue) {
      try { await _runStoryValueStep(); } catch (e) { /* 생략 */ }
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

    /* Phase J — 완료 후 기본 장면 생성(훅). 실패해도 완료/진입은 막지 않음.
       COMPASS-LENGTH-BASE: answers 동봉 → v2 targetLength(8/12/15)가 기본 장면 수에 반영(v1=8 기존 동일). */
    try {
      if (typeof window.ThoughtCompassComplete !== 'undefined' && window.ThoughtCompassComplete
          && typeof window.ThoughtCompassComplete.afterComplete === 'function') {
        /* COMPASS-VALUE-1: 고른 가치를 초안 생성에 전달(answers 스키마 무접촉·별도 필드) */
        await window.ThoughtCompassComplete.afterComplete(Object.assign({}, R.ctx, {
          answers: R.vm.answers,
          storyValue: (R._storyValue && R._storyValue.picked) || null,
        }));
      }
    } catch (e) { /* noop — 장면 생성 실패는 maker에서 수동 생성 가능 */ }

    /* 게이트/검토 닫기 → maker 노출 */
    /* LEVELS-CONT fix: 환영 필터용 projectType은 R 해제 전에 확보 */
    var _ptypeForWelcome = (R && R.ctx && R.ctx.projectType) ? R.ctx.projectType : null;
    _remove();
    if (window.ThoughtCompassGate && typeof window.ThoughtCompassGate.closeGate === 'function') window.ThoughtCompassGate.closeGate();
    if (_UI() && typeof _UI().close === 'function') _UI().close();
    R = null;

    /* TUTORIAL-PRD(S2): 생각 나침반 질문을 끝내고 에디터로 들어오는 이 순간에 환영 튜토리얼을 띄운다
       (사용자 결정 "나침반 뒤"). 기기당 1회·닫힘 대기·실패해도 에디터 진입 무영향. */
    if (typeof window !== 'undefined' && window.TutorialWelcome && typeof window.TutorialWelcome.maybeShow === 'function') {
      /* TUTORIAL-SCOPE-MAKER(#4): 나침반 완료 경로도 모둠 계정 스코프로(ui.js와 동일 헬퍼) —
         같은 기기 다른 모둠에 '다시 열지 않기'가 새지 않게. */
      var _scope = (typeof window.__makerTutorialScope === 'function') ? window.__makerTutorialScope() : null;
      /* LEVELS-CONT fix: filterType 미전달로 유형/단계(pbLevels) 필터가 죽어 1·2단계 환영이
         3단계 슬라이드로 나오던 것 정정. ctx는 위에서 R 해제 전에 확보한 projectType 사용. */
      try { await window.TutorialWelcome.maybeShow({ scope: _scope, filterType: _ptypeForWelcome || null }); } catch (e) { /* noop */ }
    }

    /* LV1-PROTAG-VISION(2026-07-22): 나침반 오버레이가 완전히 닫힌 '브랜치 화면'에서 1단계
       주인공 그리기 선택을 띄운다(오버레이 뒤 가려져 멈추던 것 방지). pending 없으면 no-op. */
    if (typeof window !== 'undefined' && typeof window.__runPendingLv1ProtagChoice === 'function') {
      try { await window.__runPendingLv1ProtagChoice(); } catch (e) { /* noop */ }
    }
  }

  function close() { _remove(); R = null; }

  window.ThoughtCompassReview = { open: open, openReadOnly: openReadOnly, close: close, _render: _render };
})();
