/* thought-compass-ui.js — 한 화면 한 질문 DOM 렌더/이벤트(브라우저 전용).
   순수 흐름은 thought-compass-flow.js(ThoughtCompassFlow), 저장은 thought-compass-store.js.
   · 한 화면 한 질문 · 선택지 3 + 직접 적기 + 모르겠어요 · 이전/다음 · 진행률 · 답변 복원
   · 입력 매 키 저장 금지(700ms debounce draft), '다음'에서 flush+확정(DATA-02/03).
   · 저장 실패 시 index 이동 금지(commitNext는 저장 성공 후에만). 중복 제출 차단. */
;(function () {
  'use strict';
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  const OVERLAY_ID = 'thought-compass-flow';
  const DRAFT_DEBOUNCE_MS = 700;

  function _Flow() { return window.ThoughtCompassFlow; }
  function _Store() { return window.ThoughtCompassStore; }
  function _Q() { return window.ThoughtCompassQuestions; }
  function _TC() { return window.ThoughtCompass; }
  function _Gate() { return window.ThoughtCompassGate; }

  let S = null;   /* { ctx, vm, busy, draftTimer, error } — 보조단계(assistance)는 vm에 저장 */

  function _el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function _remove() {
    const o = document.getElementById(OVERLAY_ID);
    if (o && o.parentNode) o.parentNode.removeChild(o);
  }

  function _ES() { return window.ThoughtCompassEditSession; }

  async function open(ctx) {
    /* 편집권한 획득(Phase K) — 1명만 편집, 타인 활성이면 읽기 전용/이어받기. */
    const ES = _ES();
    if (ES && typeof ES.acquire === 'function') {
      let acc = null;
      try { acc = await ES.acquire(ctx); } catch (e) { acc = null; }
      if (acc && acc.role === 'readonly') { _renderReadOnly(ctx); return; }
      if (acc && acc.role === 'takeoverOffer') { _renderTakeover(ctx); return; }
      /* editor 또는 획득 판정 불가(fail-open) → 진행. */
    }
    await _openFlow(ctx);
    if (ES && typeof ES.startHeartbeat === 'function') {
      ES.startHeartbeat(ctx);
      ES.subscribe(ctx, function (access) {
        if (access && (access.role === 'readonly' || access.role === 'takeoverOffer') && S && !S.editMode) {
          ES.stopHeartbeat();               /* 편집권한 상실(타인 이어받음) → 읽기 전용 전환(LOCK-03) */
          _renderReadOnly(ctx);
        }
      });
    }
  }

  async function _openFlow(ctx) {
    const Flow = _Flow(), Store = _Store(), TC = _TC();
    if (!Flow || !TC) return;
    let state = null;
    if (Store && typeof Store.loadThoughtCompassStateResult === 'function') {
      try { const r = await Store.loadThoughtCompassStateResult(ctx); state = r && r.raw; } catch (e) { state = null; }
    }
    const rp = TC.resolveResumePoint(state);
    /* V2: 질문 세트 버전 판별(fresh/v2 데이터→2, v1 진행·완료 데이터→1). 저장 시 재스탬프용으로 S에 보존. */
    /* MODE-REGRESS-GUARD(2026-07-16): foundation(thought-compass.js) 미로드 시 폴백을 옛 모드(1)가
       아니라 최신(2)으로 — 스테일/부분 로드가 "옛 모드 회귀"로 굳는 것을 방지. 정상 로드 시엔 무영향. */
    let qVersion = (typeof TC.resolveQuestionSetVersion === 'function') ? TC.resolveQuestionSetVersion(state) : 2;
    /* LEVELS(2026-07-19): 그림책 1단계(easy=3)·2단계(linear=4) — 아직 버전/답이 없는 신규 세션만.
       markStarted(컨트롤러)가 스탬프하지만, 스탬프 전에 읽은 state로 열리는 레이스를 여기서 보정.
       진행·완료 데이터(v1/v2)는 저장 버전 그대로(위 resolve가 이김). */
    const _freshNoVersion = !state || (!state.version
      && !(state.answers && typeof state.answers === 'object' && Object.keys(state.answers).length > 0));
    if (qVersion === 2 && _freshNoVersion
        && ctx && ctx.projectType === 'picturebook'
        && typeof window.getPicturebookLevel === 'function') {
      const _lv = window.getPicturebookLevel();
      /* EASY-MUSTINC(2026-07-20): 1단계 신규=easy2(5). 컨트롤러 _begin 매핑과 동기. */
      if (_lv === 1) qVersion = 5;
      else if (_lv === 2) qVersion = 4;
    }
    const vm = Flow.createFlow({ version: qVersion, resume: { index: rp.questionIndex, answers: rp.answers } });
    const followUps = Array.isArray(rp.followUps) ? rp.followUps.slice() : [];
    S = { ctx: ctx, vm: vm, busy: false, draftTimer: null, error: null, version: qVersion,
          followUps: followUps, followUpsUsed: followUps.length, followUp: null, aiBusy: false,
          editMode: false, onEditComplete: null, customMode: null };
    _render();
  }

  /* 검토 화면 '고치기' — 특정 핵심 질문 1개만 수정 후 검토로 복귀(Phase I, D-09). 다른 답변 보존. */
  function openForEdit(ctx, vm, index, onComplete) {
    const Flow = _Flow();
    /* V2: vm 질문 세트로 버전 파생(검토 화면 '고치기' 경유 — 저장 재스탬프용).
       LEVELS: heroWho=easy(3)·protagonistName=linear(4)·targetLength=2·그 외 1. */
    const _hasQ = function (id) { return !!(vm && Array.isArray(vm.questions) && vm.questions.some(function (q) { return q && q.id === id; })); };
    /* EASY-MUSTINC 배선 보강(2026-07-20 감사 발견): easy2(mustInclude)=5를 heroWho(easy)보다
       먼저 — easy2 세트엔 heroWho도 있어 순서가 바뀌면 3으로 오파생 → 고치기 저장 시 DB version
       5→3 강등, 이탈 후 재개가 8문항 easy로 열려 9번 질문·답이 사라짐. review.js _complete와 동일 순서. */
    const qVersion = _hasQ('mustInclude') ? 5 : (_hasQ('heroWho') ? 3 : (_hasQ('protagonistName') ? 4 : (_hasQ('targetLength') ? 2 : 1)));
    S = { ctx: ctx, vm: Flow.goToIndex(vm, index), busy: false, draftTimer: null, error: null, version: qVersion,
          followUps: [], followUpsUsed: 0, followUp: null, aiBusy: false,
          editMode: true, onEditComplete: (typeof onComplete === 'function') ? onComplete : null, customMode: null };
    _render();
  }

  function _render() {
    if (!S) return;
    if (S.followUp) { _renderFollowUp(); return; }     /* AI 후속질문 화면(Phase H) */
    const Flow = _Flow();
    const q = Flow.currentQuestion(S.vm);
    if (!q) return;
    const prog = Flow.progress(S.vm);
    const ans = Flow.currentAnswer(S.vm);
    const selectedChoiceId = ans && ans.choiceId ? ans.choiceId : null;
    /* 직접 적기 표시 = 이번 질문에서 직접 적기 모드를 켰거나(빈 입력 포함), 복원된 custom 답(텍스트 있음·선택지 아님). */
    const isCustom = (S.customMode === q.id) || !!(ans && ans.answerText && !selectedChoiceId && !(ans.deferred));
    const customText = (ans && ans.answerText && !selectedChoiceId && !ans.deferred) ? ans.answerText : '';
    const isDeferred = !!(ans && ans.deferred);
    const assistPrompt = Flow.assistancePrompt(S.vm);

    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '생각 나침반');

    const card = _el('div', 'tc-flow-card');

    /* 진행률 — 얇은 막대 + 숫자(WIRE-03) */
    const progWrap = _el('div', 'tc-flow-progress');
    const bar = _el('div', 'tc-flow-progress-bar');
    const fill = _el('div', 'tc-flow-progress-fill');
    fill.style.width = Math.round((prog.current / prog.total) * 100) + '%';
    bar.appendChild(fill);
    progWrap.appendChild(_el('div', 'tc-flow-progress-label', prog.label));
    progWrap.appendChild(bar);
    card.appendChild(progWrap);

    /* COMPASS-CONTEXT-STRIP(2026-07-10): 질문 간 유기성 — 직전 답 최대 2개를 화면에 보여줘
       "지금까지의 내 이야기 위에 쌓는다"는 감각을 만든다(기존엔 AI에게만 priorSummaries 전달·학생 화면엔 없음).
       targetLength(장면 수)는 스토리 요소가 아니라 제외. 표시만·저장/판정 무영향. */
    try {
      if (typeof _priorSummaries === 'function') {
        const _prior = _priorSummaries().filter(s => s.key !== q.id && s.key !== 'targetLength');
        if (_prior.length) {
          const _t = (s) => { const x = String(s.text || '').trim(); return '“' + (x.length > 26 ? x.slice(0, 26) + '…' : x) + '”'; };
          const strip = _el('p', 'tc-flow-help', '📖 지금까지 내 이야기: ' + _prior.slice(-2).map(_t).join(' → '));
          strip.style.cssText = 'margin:2px 0 0;padding:7px 11px;background:#f4efe2;border:1px solid #e3d9c2;border-radius:9px;font-size:12.5px;color:#6b5a38;line-height:1.5;';
          card.appendChild(strip);
        }
      }
    } catch (e) { /* 표시 실패해도 흐름 무영향 */ }

    /* 질문 */
    const qTitle = _el('h2', 'tc-flow-title', q.title);
    qTitle.id = 'tc-flow-title';
    card.appendChild(qTitle);
    if (q.help) card.appendChild(_el('p', 'tc-flow-help', q.help));
    /* FREE-NOTE: 첫 질문 화면에 참고 자료 안내(짧게) — "반드시 이대로" 인상 방지. */
    if (prog && prog.current === 1) {
      card.appendChild(_el('p', 'tc-flow-help tc-flow-help--guide', '생각 나침반은 이야기를 시작하기 위한 참고 자료예요. 떠오르는 생각이 있으면 자유롭게 바꿔도 괜찮아요.'));
    }
    overlay.setAttribute('aria-labelledby', 'tc-flow-title');

    /* 모르겠어요 안내(Phase F) — 부드러운 안내(오류처럼 표시하지 않음, 재촉 없음) */
    if (assistPrompt) card.appendChild(_el('p', 'tc-flow-assist', assistPrompt));
    if (isDeferred) {
      card.appendChild(_el('p', 'tc-flow-defer', '“' + ans.answerText + '”로 정했어요. 이야기를 만들면서 더 떠올려도 좋아요.'));
    }

    /* ADAPTIVE-CHOICES(2026-07-24): 앞 답 의존 질문(q.adaptive)이면 맥락 맞춤 보기로 교체.
       성공=AI 보기 / 미조회=고정 보기 자리표시 + 조회 시작 / 실패·지연=고정 보기 폴백.
       재로드 후 이미 답한 맞춤 보기는 저장된 답 1칸으로 표시(재호출 안 함). */
    let _choicesToRender = q.choices || [];
    let _adaptive = null, _adaptiveLoading = false;
    if (q.adaptive) {
      if (!S.adaptiveChoices) S.adaptiveChoices = {};
      _adaptive = S.adaptiveChoices[q.id];
      if (Array.isArray(_adaptive)) {
        _choicesToRender = _adaptive;
      } else if (ans && ans.answerText && selectedChoiceId) {
        _choicesToRender = [{ id: selectedChoiceId, label: ans.answerText, value: ans.answerText }];
      } else if (_adaptive === 'failed') {
        _choicesToRender = q.choices || [];
      } else if (!isCustom && !isDeferred) {
        _adaptiveLoading = true;
        _choicesToRender = [];   /* 로딩 중엔 고정 보기를 보여주지 않음 — 번쩍임 방지(스켈레톤만) */
        if (_adaptive == null) _fetchAdaptive(q);
      }
    }
    if (_adaptiveLoading) {
      const ld = _el('p', 'tc-flow-help', '✨ 내 이야기에 맞는 보기를 고르는 중…');
      ld.style.cssText = 'margin:2px 0 6px;font-size:12.5px;color:#7a8a5b;';
      card.appendChild(ld);
    }
    /* 선택지 3개 + 직접 적기(동등 카드, WIRE-02) */
    const opts = _el('div', 'tc-flow-options');
    const _isAdaptiveSet = Array.isArray(_adaptive) && _choicesToRender === _adaptive;
    _choicesToRender.forEach(c => {
      const b = _el('button', 'tc-flow-choice' + (selectedChoiceId === c.id ? ' is-selected' : ''), c.label);
      b.type = 'button';
      b.setAttribute('aria-pressed', selectedChoiceId === c.id ? 'true' : 'false');
      b.addEventListener('click', function () { _isAdaptiveSet ? _onAdaptiveChoice(c.id, c.value) : _onChoice(c.id); });
      opts.appendChild(b);
    });
    /* ADAPTIVE-CHOICES: 로딩 중 스켈레톤 자리표시(고정 보기 번쩍임 대체·레이아웃 유지) */
    if (_adaptiveLoading) {
      if (!document.getElementById('tc-skeleton-style')) {
        const st = document.createElement('style');
        st.id = 'tc-skeleton-style';
        st.textContent = '@keyframes tcSkel{0%{background-position:200% 0}100%{background-position:-200% 0}}'
          + '.tc-flow-choice--skeleton{height:46px;border-radius:12px;pointer-events:none;'
          + 'background:linear-gradient(90deg,#f1ead9 25%,#f8f2e4 37%,#f1ead9 63%);'
          + 'background-size:400% 100%;animation:tcSkel 1.3s ease-in-out infinite;}';
        document.head.appendChild(st);
      }
      for (let _si = 0; _si < 3; _si++) {
        const sk = _el('div', 'tc-flow-choice tc-flow-choice--skeleton');
        sk.setAttribute('aria-hidden', 'true');
        opts.appendChild(sk);
      }
    }
    /* 직접 적기 카드 — V2 targetLength(allowCustom:false)는 보기 전용이라 미노출. */
    if (q.allowCustom !== false) {
      const customWrap = _el('div', 'tc-flow-custom' + (isCustom ? ' is-active' : ''));
      const customBtn = _el('button', 'tc-flow-choice tc-flow-choice--custom' + (isCustom ? ' is-selected' : ''), '✏️ ' + (q.customLabel || '직접 적을래요'));
      customBtn.type = 'button';
      customBtn.setAttribute('aria-pressed', isCustom ? 'true' : 'false');
      customBtn.addEventListener('click', function () { _onCustomActivate(); });
      customWrap.appendChild(customBtn);
      if (isCustom) {
        const ta = _el('textarea', 'tc-flow-custom-input');
        ta.value = customText;
        ta.maxLength = q.maxLength || 200;
        ta.setAttribute('aria-label', q.customLabel || '직접 적기');
        ta.placeholder = '여기에 적어 보세요';
        ta.addEventListener('input', function () { _onCustomInput(ta.value); });
        customWrap.appendChild(ta);
        const counter = _el('div', 'tc-flow-counter', customText.length + ' / ' + (q.maxLength || 200));
        ta.addEventListener('input', function () { counter.textContent = ta.value.length + ' / ' + (q.maxLength || 200); });
        customWrap.appendChild(counter);
      }
      opts.appendChild(customWrap);
    }
    card.appendChild(opts);

    /* 모르겠어요 */
    const unsure = _el('button', 'tc-flow-unsure', '모르겠어요');
    unsure.type = 'button';
    unsure.addEventListener('click', function () { _onUnsure(); });
    card.appendChild(unsure);

    /* 저장 오류(있으면) */
    if (S.error) {
      const err = _el('p', 'tc-flow-error', S.error);
      err.setAttribute('role', 'alert');
      card.appendChild(err);
    }
    /* AI 판정 대기 — 카드 하단 짧은 상태(WIRE-04, 전체화면 막지 않음·중복 제출 차단) */
    if (S.aiBusy) {
      const st = _el('p', 'tc-flow-aistatus', '답을 살펴보고 있어요…');
      st.setAttribute('role', 'status');
      card.appendChild(st);
    }

    /* 하단 네비 — 이전(두번째부터, WIRE-05) / 다음. 편집 모드는 취소 / 저장하고 돌아가기. */
    const nav = _el('div', 'tc-flow-nav');
    if (S.editMode) {
      const cancel = _el('button', 'tc-flow-prev', '취소');
      cancel.type = 'button';
      cancel.addEventListener('click', function () { _cancelEdit(); });
      nav.appendChild(cancel);
    } else if (Flow.canPrev(S.vm) && !S.aiBusy) {
      const prev = _el('button', 'tc-flow-prev', '이전');
      prev.type = 'button';
      prev.addEventListener('click', function () { _onPrev(); });
      nav.appendChild(prev);
    } else {
      nav.appendChild(_el('span', 'tc-flow-nav-spacer'));
    }
    const next = _el('button', 'tc-flow-next', S.editMode ? '저장하고 돌아가기' : (Flow.isLast(S.vm) ? '다 정했어요' : '다음'));
    next.type = 'button';
    next.disabled = !Flow.canNext(S.vm) || S.busy || S.aiBusy;
    next.addEventListener('click', function () { _onNext(); });
    nav.appendChild(next);
    card.appendChild(nav);

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    /* 접근성 — 카드/제목 포커스 */
    try { qTitle.setAttribute('tabindex', '-1'); qTitle.focus(); } catch (e) {}
  }

  function _onChoice(choiceId) {
    S.error = null;
    S.customMode = null;     /* 선택지 고르면 직접 적기 모드 해제 */
    S.vm = _Flow().setChoiceAnswer(S.vm, choiceId);
    _render();
  }
  /* ADAPTIVE-CHOICES: 맞춤 보기 선택 — q.choices에 없는 런타임 보기라 값을 직접 전달. */
  function _onAdaptiveChoice(choiceId, value) {
    S.error = null;
    S.customMode = null;
    S.vm = _Flow().setResolvedChoiceAnswer(S.vm, choiceId, value);
    _render();
  }
  /* 앞 답 기반 맞춤 보기 1회 요청. 실패/앞답없음/미배포 → 'failed'(고정 보기 폴백). */
  function _fetchAdaptive(q) {
    if (!S) return;
    if (!S.adaptiveChoices) S.adaptiveChoices = {};
    if (S.adaptiveChoices[q.id] != null) return;   /* 이미 진행/완료 */
    S.adaptiveChoices[q.id] = 'loading';
    const AI = window.ThoughtCompassAI;
    if (!AI || typeof AI.requestAdaptiveChoices !== 'function') { S.adaptiveChoices[q.id] = 'failed'; return; }
    const prior = (typeof _priorSummaries === 'function' ? _priorSummaries() : [])
      .filter(function (s) { return s && s.key !== q.id && s.key !== 'targetLength' && s.text; });
    if (!prior.length) { S.adaptiveChoices[q.id] = 'failed'; return; }   /* 앞 답 없으면 폴백 */
    const priorText = prior.map(function (s) { return String(s.text || '').trim(); }).join(' / ').slice(0, 1500);
    const ctx = S.ctx || {};
    const capturedId = q.id;
    const capturedIndex = (S.vm && typeof S.vm.index === 'number') ? S.vm.index : null;
    AI.requestAdaptiveChoices({
      classId: ctx.classId, teamName: ctx.teamName, projectType: ctx.projectType,
      questionId: q.id, questionTitle: q.title, priorAnswersText: priorText,
      staticChoices: (q.choices || []).map(function (c) { return c.label; }),
    }).then(function (res) {
      if (!S || !S.adaptiveChoices) return;
      if (res && res.ok && Array.isArray(res.choices) && res.choices.length === 3) {
        S.adaptiveChoices[capturedId] = res.choices.map(function (c, i) {
          return { id: 'adaptive_' + i, label: String(c.label || ''), value: String(c.value || c.label || '') };
        });
      } else {
        S.adaptiveChoices[capturedId] = 'failed';
      }
      /* 아직 같은 질문 화면이면 다시 그림(다른 질문으로 이동했으면 무시) */
      if (S.vm && S.vm.index === capturedIndex && !S.followUp) _render();
    });
  }
  function _onCustomActivate() {
    S.error = null;
    /* 직접 적기 카드 활성화 — 이 질문에 대해 입력 모드 ON(빈 입력이라도 textarea 노출). */
    const q = _Flow().currentQuestion(S.vm);
    /* CUSTOM-RETAP-GUARD(#3): 이미 직접 적기 모드거나 기존 custom 답이 있으면 초기화하지 않고
       textarea focus만. (버튼이 입력칸 바로 위에 계속 떠 있어 터치 기기에서 재탭 시 입력이
       통째로 지워지던 것 방지 — 최대 200자 유실·되돌리기 없음.) */
    const ans = _Flow().currentAnswer(S.vm);
    const alreadyCustom = (q && S.customMode === q.id)
      || !!(ans && ans.answerText && !ans.choiceId && !ans.deferred);
    if (alreadyCustom) {
      const ta0 = document.querySelector('.tc-flow-custom-input');
      if (ta0) { try { ta0.focus(); } catch (e) {} }
      return;
    }
    S.customMode = q ? q.id : null;
    S.vm = _Flow().setCustomAnswer(S.vm, '', { draft: true });
    _render();
    const ta = document.querySelector('.tc-flow-custom-input');
    if (ta) { try { ta.focus(); } catch (e) {} }
  }
  function _onCustomInput(text) {
    S.vm = _Flow().setCustomAnswer(S.vm, text, { draft: true });
    /* next 활성/비활성만 즉시 갱신(전체 재렌더 회피 — 포커스 유지) */
    const next = document.querySelector('.tc-flow-next');
    if (next) next.disabled = !_Flow().canNext(S.vm) || S.busy;
    /* 700ms debounce draft 저장(매 키 저장 금지) */
    if (S.draftTimer) clearTimeout(S.draftTimer);
    S.draftTimer = setTimeout(function () { _saveDraft(); }, DRAFT_DEBOUNCE_MS);
  }
  async function _saveDraft() {
    const Store = _Store(), Flow = _Flow();
    if (!Store) return;
    try {
      const patch = Flow.buildSavePatch(S.vm, { index: S.vm.index });
      await Store.saveThoughtCompassProgress(S.ctx, { status: 'inProgress', version: (S && S.version) || 1 }, patch);
    } catch (e) { /* draft 실패는 조용히(다음에서 flush 재시도) */ }
  }
  function _onUnsure() {
    /* Phase F: 첫 클릭 → 쉬운 안내(같은 보기 유지), 그 다음 클릭 → 최소 유예 답변(빈 답 아님). */
    S.error = null;
    S.customMode = null;     /* 모르겠어요 흐름에서는 직접 적기 입력창 닫음 */
    const r = _Flow().handleUnsure(S.vm);
    S.vm = r.vm;
    _render();
  }
  function _onPrev() {
    if (S.busy) return;
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }
    S.error = null;
    S.vm = _Flow().goPrev(S.vm);
    _render();
  }
  async function _onNext() {
    if (S.busy || S.aiBusy) return;     /* 중복 제출 차단 */
    const Flow = _Flow(), Store = _Store();
    if (!Flow.canNext(S.vm)) return;
    S.busy = true; S.error = null;
    const next = document.querySelector('.tc-flow-next');
    if (next) next.disabled = true;
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }

    const last = Flow.isLast(S.vm);
    const targetIndex = last ? S.vm.index : S.vm.index + 1;
    let ok = true;
    if (Store) {
      try {
        const patch = Flow.buildSavePatch(S.vm, { index: targetIndex });
        await Store.saveThoughtCompassProgress(S.ctx, { status: 'inProgress', version: (S && S.version) || 1 }, patch);
      } catch (e) { ok = false; }
    }
    if (!ok) {
      S.busy = false; S.error = '저장하지 못했어요. 다시 시도해 주세요.';
      _render();
      return;                            /* 저장 실패 → index 이동 금지 */
    }
    S.busy = false;
    if (S.editMode) {
      /* 단일 수정 — 저장 후 검토 화면으로 복귀(AI 후속 재호출 없음). */
      const cb = S.onEditComplete; const vm = S.vm;
      if (cb) cb(vm);
      return;
    }
    /* 핵심 답변 저장 완료 → AI 후속질문 판정(Phase H) */
    await _judgeAndAdvance(last);
  }

  function _cancelEdit() {
    if (S.busy) return;
    const cb = S.onEditComplete;
    if (S.draftTimer) { clearTimeout(S.draftTimer); S.draftTimer = null; }
    if (cb) cb(null);     /* null = 변경 취소(검토 화면이 기존 답 유지) */
  }

  /* 모든 핵심 답변 요약(AI 입력용, PII 없음). */
  function _priorSummaries() {
    const out = [];
    for (const q of S.vm.questions) {
      const a = S.vm.answers[q.id];
      if (a && a.answerText) out.push({ key: q.id, text: String(a.answerText).slice(0, 200) });
    }
    return out;
  }

  /* 핵심 답변 저장 후: AI 판정 → NEXT(다음 핵심) / ASK_FOLLOW_UP(후속 화면) / ASK_EASIER(쉬운 보기). */
  async function _judgeAndAdvance(last) {
    const Flow = _Flow();
    const q = Flow.currentQuestion(S.vm);
    const ans = Flow.currentAnswer(S.vm);
    /* RE-EDIT-SKIP-JUDGE(#6): '이전'으로 돌아가 답을 안 바꾸고 다시 앞으로 가면 통과했던 질문마다
       AI 판정('답 살펴보고 있어요…')을 또 기다리고 후속질문이 중복 기록되던 것 → 이미 판정한 답과
       같으면 AI 호출을 건너뛰고 바로 다음으로(검토 화면 '고치기'의 무판정 정책과 동일). */
    if (!S.judgedAnswers) S.judgedAnswers = {};
    const _ansKey = String((ans && ans.choiceId) || '') + ' ' + String((ans && ans.answerText) || '');
    const _alreadyJudged = Object.prototype.hasOwnProperty.call(S.judgedAnswers, q.id) && S.judgedAnswers[q.id] === _ansKey;
    /* COMPASS-V2-FOLLOWUP: v2 가드 해제 — 서버 allowlist가 v1+v2 합집합으로 확장됨(15키).
       coreTotal은 vm 기반(v1=7·v2=10) — 상한도 세트별(12/15, flow.followUpBudgetLeft).
       targetLength(보기 전용)는 판정 가치가 없어 후속 요청 자체를 생략(비용·시간 절약).
       EASY-MUSTINC: mustInclude(easy2 9번·자유 희망)도 생략 — 어떤 답이든 그대로 초안에
       반영이 목적이라 판정 무의미 + 서버 followup allowlist 미등록(배포 불요) 정합.
       ※ 서버 deploy 전까지는 v2 요청이 거부→null→NEXT 안전 진행(현행과 동일 체감). */
    const meta = { followUpsUsed: S.followUpsUsed, coreTotal: S.vm.total };
    let decision = null;
    if (!_alreadyJudged && q.id !== 'targetLength' && q.id !== 'mustInclude' && Flow.followUpBudgetLeft(meta) && window.ThoughtCompassAI && typeof window.ThoughtCompassAI.requestFollowUp === 'function') {
      S.aiBusy = true; _render();
      try {
        decision = await window.ThoughtCompassAI.requestFollowUp({
          classId: S.ctx.classId, teamName: S.ctx.teamName, projectType: S.ctx.projectType,
          coreQuestionId: q.id, currentAnswer: (ans && ans.answerText) || '',
          followUpCount: S.followUpsUsed, totalQuestionCount: S.vm.total + S.followUpsUsed,
          priorSummaries: _priorSummaries(),
        });
      } catch (e) { decision = null; }
      S.aiBusy = false;
    }
    S.judgedAnswers[q.id] = _ansKey;   /* RE-EDIT-SKIP-JUDGE(#6): 이 답으로 판정 완료 기록(재방문 시 같으면 스킵) */
    const r = Flow.resolveAfterAnswer(decision && decision.decision, meta);
    if (r.action === 'easier') {
      if (Flow.assistanceLevel(S.vm) >= 2) { _advanceCore(last); return; }   /* 이미 최대 완화 → 진행 */
      S.vm = Flow.setAssistanceLevel(S.vm, Flow.assistanceLevel(S.vm) + 1);
      _render(); return;
    }
    if (r.action === 'followUp' && decision && decision.followUpQuestion) {
      S.followUp = {
        parentQuestionId: q.id, prompt: decision.followUpQuestion,
        supportOptions: Array.isArray(decision.supportOptions) ? decision.supportOptions : [],
        reasonCode: decision.reasonCode || null, afterLast: last,
        answerText: '', choiceId: null, custom: false,
      };
      S.followUpsUsed += 1;
      _render(); return;
    }
    _advanceCore(last);
  }
  function _advanceCore(last) {
    if (last) { _finishCore(); return; }
    S.vm = _Flow().commitNext(S.vm);
    _render();
  }

  /* 마지막 핵심질문 통과 → 최종 검토(Phase I). 미구현 시 자리표시 안내. */
  function _finishCore() {
    if (typeof window.ThoughtCompassReview !== 'undefined' && window.ThoughtCompassReview && typeof window.ThoughtCompassReview.open === 'function') {
      _remove();
      window.ThoughtCompassReview.open(S.ctx, S.vm, S.followUps);
      return;
    }
    /* Phase I 이전 — 검토 화면 자리표시(스켈레톤) */
    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    const card = _el('div', 'tc-flow-card');
    card.appendChild(_el('h2', 'tc-flow-title', '생각 나침반을 만들 준비가 되었어요'));
    card.appendChild(_el('p', 'tc-flow-help', '핵심 질문을 모두 마쳤어요. (최종 검토 화면은 다음 단계에서 연결됩니다.)'));
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  }

  /* ── AI 후속질문 화면(Phase H) ── 한 화면 한 후속질문. 핵심 질문은 못 건너뜀(후속만 넘어가기). */
  function _renderFollowUp() {
    const fu = S.followUp;
    const hasAnswer = !!(fu.answerText && fu.answerText.trim());
    _remove();
    const overlay = _el('div', 'tc-flow-overlay');
    overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '생각 나침반 후속 질문');
    const card = _el('div', 'tc-flow-card');

    card.appendChild(_el('div', 'tc-flow-followup-tag', '조금만 더 들려줄래요?'));
    const t = _el('h2', 'tc-flow-title', fu.prompt); t.id = 'tc-flow-title';
    card.appendChild(t);
    overlay.setAttribute('aria-labelledby', 'tc-flow-title');

    const opts = _el('div', 'tc-flow-options');
    (fu.supportOptions || []).forEach((label, i) => {
      const b = _el('button', 'tc-flow-choice' + (fu.choiceId === i ? ' is-selected' : ''), label);
      b.type = 'button';
      b.addEventListener('click', function () { _onFollowUpChoice(i); });
      opts.appendChild(b);
    });
    const customWrap = _el('div', 'tc-flow-custom' + (fu.custom ? ' is-active' : ''));
    const customBtn = _el('button', 'tc-flow-choice tc-flow-choice--custom' + (fu.custom ? ' is-selected' : ''), '✏️ 직접 적을래요');
    customBtn.type = 'button';
    customBtn.addEventListener('click', function () { _onFollowUpCustomActivate(); });
    customWrap.appendChild(customBtn);
    if (fu.custom) {
      const ta = _el('textarea', 'tc-flow-custom-input');
      ta.value = fu.answerText || '';
      ta.maxLength = 150;     /* 후속질문 직접입력 최대(D-24) */
      ta.placeholder = '여기에 적어 보세요';
      ta.addEventListener('input', function () { _onFollowUpCustomInput(ta.value); });
      customWrap.appendChild(ta);
    }
    opts.appendChild(customWrap);
    card.appendChild(opts);

    const nav = _el('div', 'tc-flow-nav');
    const skip = _el('button', 'tc-flow-prev', '이 질문은 넘어가기');
    skip.type = 'button';
    skip.addEventListener('click', function () { _onFollowUpSkip(); });
    nav.appendChild(skip);
    const next = _el('button', 'tc-flow-next', '다음');
    next.type = 'button';
    next.disabled = !hasAnswer || S.busy;
    next.addEventListener('click', function () { _onFollowUpNext(); });
    nav.appendChild(next);
    card.appendChild(nav);

    overlay.appendChild(card);
    document.body.appendChild(overlay);
    try { t.setAttribute('tabindex', '-1'); t.focus(); } catch (e) {}
  }
  function _onFollowUpChoice(i) {
    S.followUp.choiceId = i; S.followUp.custom = false;
    S.followUp.answerText = (S.followUp.supportOptions[i] || '');
    _renderFollowUp();
  }
  function _onFollowUpCustomActivate() {
    /* CUSTOM-RETAP-GUARD(#3): 이미 직접 적기 모드에서 답을 쓰는 중이면 초기화하지 말고 focus만. */
    if (S.followUp.custom && S.followUp.answerText) {
      const ta0 = document.querySelector('.tc-flow-custom-input');
      if (ta0) { try { ta0.focus(); } catch (e) {} }
      return;
    }
    S.followUp.custom = true; S.followUp.choiceId = null; S.followUp.answerText = '';
    _renderFollowUp();
    const ta = document.querySelector('.tc-flow-custom-input');
    if (ta) { try { ta.focus(); } catch (e) {} }
  }
  function _onFollowUpCustomInput(text) {
    S.followUp.answerText = String(text || '').slice(0, 150);
    const next = document.querySelector('.tc-flow-next');
    if (next) next.disabled = !S.followUp.answerText.trim() || S.busy;
  }
  async function _onFollowUpNext() {
    if (S.busy) return;
    const fu = S.followUp;
    if (!fu.answerText || !fu.answerText.trim()) return;
    S.busy = true;
    const entry = {
      id: fu.parentQuestionId + '_fu' + (S.followUps.length + 1),
      parentQuestionId: fu.parentQuestionId,
      prompt: fu.prompt,
      answer: fu.answerText.trim(),
      reasonCode: fu.reasonCode || null,
      order: S.followUps.length + 1,
    };
    S.followUps.push(entry);
    const Store = _Store();
    if (Store && typeof Store.saveThoughtCompassFollowUps === 'function') {
      try { await Store.saveThoughtCompassFollowUps(S.ctx, S.followUps); }
      catch (e) { /* 저장 실패해도 진행 차단하지 않음(세션 보존, 다음에서 재시도) */ }
    }
    S.busy = false;
    const afterLast = fu.afterLast;
    S.followUp = null;
    _advanceCore(afterLast);
  }
  function _onFollowUpSkip() {
    if (S.busy) return;
    const afterLast = S.followUp.afterLast;
    S.followUp = null;     /* 후속질문만 종료(핵심 질문은 건너뛰지 않음) */
    _advanceCore(afterLast);
  }

  /* ── 편집권한: 읽기 전용 / 이어받기 화면(Phase K) ── */
  function _renderReadOnly(ctx) {
    const ES = _ES();
    if (ES && typeof ES.unsubscribe === 'function') ES.unsubscribe();
    if (ES && typeof ES.stopHeartbeat === 'function') ES.stopHeartbeat();
    S = null;
    _remove();
    const overlay = _el('div', 'tc-flow-overlay'); overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-modal', 'true');
    const card = _el('div', 'tc-flow-card');
    card.appendChild(_el('h2', 'tc-flow-title', '다른 친구가 작성하고 있어요'));
    /* READONLY-COPY(#5): 이전 기기가 꺼졌거나(배터리·크래시) 다른 기기가 세션을 막 인수한 직후엔
       세션이 살아 있는 것으로 보여 이어받기가 안 되는데, 그 이유를 몰라 막막해하던 것 → 잠시 뒤
       (약 3분 무활동) '다시 확인'으로 이어받을 수 있음을 안내. */
    card.appendChild(_el('p', 'tc-flow-help', '지금은 다른 친구(또는 다른 기기)가 생각 나침반을 작성하고 있어요. 답은 함께 볼 수 있어요.'));
    card.appendChild(_el('p', 'tc-flow-help', '조금 전까지 쓰던 기기가 꺼졌거나 친구가 멈췄다면, 잠시 뒤(약 3분)에 “다시 확인”을 누르면 이어서 할 수 있어요.'));
    const nav = _el('div', 'tc-flow-nav'); nav.appendChild(_el('span', 'tc-flow-nav-spacer'));
    const retry = _el('button', 'tc-flow-next', '다시 확인'); retry.type = 'button';
    retry.addEventListener('click', function () { open(ctx); });
    nav.appendChild(retry); card.appendChild(nav);
    overlay.appendChild(card); document.body.appendChild(overlay);
  }
  function _renderTakeover(ctx) {
    _remove();
    const overlay = _el('div', 'tc-flow-overlay'); overlay.id = OVERLAY_ID;
    overlay.setAttribute('role', 'alertdialog'); overlay.setAttribute('aria-modal', 'true');
    const card = _el('div', 'tc-flow-card');
    card.appendChild(_el('h2', 'tc-flow-title', '3분 동안 활동이 없어요'));
    card.appendChild(_el('p', 'tc-flow-help', '이어서 작성할까요? 친구가 작성하던 내용은 그대로 이어서 볼 수 있어요.'));
    const nav = _el('div', 'tc-flow-nav');
    const later = _el('button', 'tc-flow-prev', '나중에'); later.type = 'button';
    later.addEventListener('click', function () { _renderReadOnly(ctx); });
    nav.appendChild(later);
    const go = _el('button', 'tc-flow-next', '이어서 작성하기'); go.type = 'button';
    go.addEventListener('click', async function () {
      go.disabled = true;
      const ES = _ES();
      let acc = null;
      try { acc = ES ? await ES.takeover(ctx) : { role: 'editor' }; } catch (e) { acc = null; }
      if (acc && acc.role === 'editor') {
        await _openFlow(ctx);
        if (ES && typeof ES.startHeartbeat === 'function') {
          ES.startHeartbeat(ctx);
          ES.subscribe(ctx, function (access) {
            if (access && (access.role === 'readonly' || access.role === 'takeoverOffer') && S && !S.editMode) { ES.stopHeartbeat(); _renderReadOnly(ctx); }
          });
        }
      } else {
        _renderReadOnly(ctx);   /* 그새 다른 사람이 이어받음 */
      }
    });
    nav.appendChild(go); card.appendChild(nav);
    overlay.appendChild(card); document.body.appendChild(overlay);
  }

  function close() {
    const ES = _ES(); const ctx = S && S.ctx;
    if (S && S.draftTimer) clearTimeout(S.draftTimer);
    if (ES) {
      try { ES.stopHeartbeat(); ES.unsubscribe(); if (ctx && typeof ES.release === 'function') ES.release(ctx); } catch (e) {}
    }
    _remove(); S = null;
  }

  window.ThoughtCompassUI = { open: open, openForEdit: openForEdit, close: close, _render: _render };
})();
