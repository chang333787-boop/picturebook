/* ════════════════════════════════════════════════════════════════
   SHELF-1 + COMMENT-1 (2026-07-11): 학급 책장 + 작품 댓글 — viewer 클라이언트.
   ─────────────────────────────────────────────────────────────
   · 책장: getClassShelf callable(코드/공개 검증 서버) → #shelf-screen(JS 생성) 그리드.
     표지 탭 → 기존 _enterViewer 재사용. 복귀 = 상태 전환(창/history 무접촉).
   · 댓글: 읽기 = comments 노드 직접 read(rules가 작품 공개와 동일 게이트),
     쓰기 = postWorkComment callable(이름·내용·댓글 코드 — 코드는 세션 기억).
   · 컨텍스트: sessionStorage branchShelfCtx = {classId, code?} — HUD [📚] 노출 조건.
   · 디자인 = mockups/shelf-comment-mockup.html 확정 시안(웜톤·가운데 정렬 max 980).
   ════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const SS_CTX  = 'branchShelfCtx';
  const SS_CODE = 'branchCommentCode';
  let _shelfData = null;          /* 마지막 getClassShelf 응답 */
  let _drawerEl = null;

  /* ── 유틸 ── */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function _ctx() {
    try { return JSON.parse(sessionStorage.getItem(SS_CTX) || 'null'); } catch (e) { return null; }
  }
  function _setCtx(v) {
    try { v ? sessionStorage.setItem(SS_CTX, JSON.stringify(v)) : sessionStorage.removeItem(SS_CTX); } catch (e) {}
  }
  function _fns() {
    /* 입장 직후엔 기본 앱이 아직 없을 수 있음 — getViewerApp(viewer-data)이 초기화를 보장 */
    const app = (typeof getViewerApp === 'function') ? getViewerApp() : firebase.app();
    return app.functions('asia-northeast3');
  }

  /* 표지 미니 색 — 저장된 coverTheme 토큰 우선, 없으면 모드별 기본 */
  const COVER_COLORS = {
    /* coverTheme/스킨 토큰 후보 → [배경, 글자] */
    cozy: ['#f7edd8', '#3a2c14'], paper: ['#efe3c8', '#4a3a22'], gallery: ['#c9b790', '#3a2c14'],
    forest: ['#4a6a44', '#f2eddc'], night: ['#2d3a55', '#f0e8d0'],
    _text: ['#f3ead2', '#3a2c14'], _picturebook: ['#e8d9b0', '#3a2c14'], _movie: ['#3a3a3a', '#f0e8d0'],
  };
  function _coverColor(w) {
    return COVER_COLORS[w.th] || COVER_COLORS['_' + w.ty] || ['#e8d9b0', '#3a2c14'];
  }

  /* ── 책장 화면 ── */
  function _screenEl() {
    let el = document.getElementById('shelf-screen');
    if (!el) {
      el = document.createElement('div');
      el.id = 'shelf-screen';
      el.className = 'hidden';
      document.body.appendChild(el);
    }
    return el;
  }
  function _showShelf() {
    const e = document.getElementById('entry-screen');
    /* ENTRY-STUCK-FIX(2026-07-17): _enterViewer 실패 catch가 박은 인라인 display:flex !important를
       걷어야 책장이 entry 위로 제대로 보인다(#24·#51). */
    if (e) { e.style.removeProperty('display'); e.classList.add('hidden'); }
    document.getElementById('player-screen')?.classList.add('hidden');
    _screenEl().classList.remove('hidden');
    /* LINK-LOADING-1: 책장 링크 자동진입 로딩('책장으로 들어가는 중…')을 책장 표시 시점에 확실히 제거
       (openShelf 프로미스 타이밍에 의존하지 않음). */
    try { if (typeof window.__hideAutoEnterLoading === 'function') window.__hideAutoEnterLoading(); } catch (e2) {}
    closeComments();
    try { if (typeof ViewerState !== 'undefined' && ViewerState.resetPlayback) ViewerState.resetPlayback(); } catch (e) {}
  }
  function _hideShelf() {
    _screenEl().classList.add('hidden');
  }

  function _renderShelf(data) {
    const el = _screenEl();
    const works = data.works || [];
    const booksHtml = works.length ? works.map(w => {
      const [bg, fg] = _coverColor(w);
      return `
        <div class="shelf-book" data-team="${esc(w.team)}" role="button" tabindex="0"
          aria-label="${esc(w.t || '제목 없는 책')} — ${esc(w.nick || w.team)}">
          <div class="shelf-cover" style="background:${bg};color:${fg};">
            <span class="shelf-badge">💬 ${w.cc || 0}</span>
            <div class="shelf-cover-t">${esc(w.t || '(제목이 아직 없어요)')}</div>
            ${w.s ? `<div class="shelf-cover-s">${esc(w.s)}</div>` : ''}
          </div>
          <div class="shelf-team">${esc(w.nick || w.team)}</div>
        </div>`;
    }).join('') : `
      <div class="shelf-empty">아직 공개된 작품이 없어요.<br>선생님이 관리 화면에서 작품을 공개하면 여기에 나타나요.</div>`;
    el.innerHTML = `
      <div class="shelf-inner">
        <div class="shelf-head">
          <h1>📚 우리 반 책장</h1>
          <span class="shelf-cnt">${esc(data.className || '')}${data.className ? ' · ' : ''}공개된 작품 ${works.length}권</span>
          <a class="shelf-home" href="index.html">🌿 처음으로</a>
        </div>
        <div class="shelf-grid">${booksHtml}</div>
        <div class="shelf-foot">표지를 누르면 그 책이 열려요 · 책을 보다가 위의 📚 버튼으로 언제든 돌아올 수 있어요</div>
      </div>`;
    el.querySelectorAll('.shelf-book').forEach(b => {
      const open = () => _openWork(b.dataset.team);
      b.addEventListener('click', open);
      b.addEventListener('keydown', e => { if (e.key === 'Enter') open(); });
    });
  }

  async function _openWork(teamName) {
    const ctx = _ctx();
    if (!ctx || !teamName) return;
    _hideShelf();
    /* SHELF-OPEN-FAIL-FIX(#51): _enterViewer는 내부 catch로 에러를 삼키므로(throw 안 함) 반환값으로 판정.
       false면 비공개 전환/로드 실패 → entry가 아니라 책장으로 복귀(코드 재입력 강요 방지). */
    let ok = false;
    try { ok = await _enterViewer(teamName, false, false, ctx.classId); }
    catch (e) { ok = false; }
    if (!ok) _showShelf();
  }

  /* 코드 또는 링크(공개 학급)로 책장 열기 */
  async function openShelf(opts) {
    const payload = {};
    if (opts && opts.classCode) payload.classCode = opts.classCode;
    else if (opts && opts.classId) payload.classId = opts.classId;
    const res = await _fns().httpsCallable('getClassShelf')(payload);
    const data = (res && res.data) || {};
    if (!data.ok) throw new Error('책장을 불러오지 못했어요.');
    _shelfData = data;
    /* 코드로 열었으면 코드도 보관 — 복귀 재조회(배지 갱신)가 같은 자격으로 통과하게 */
    _setCtx({ classId: data.classId, code: (opts && opts.classCode) || null });
    _renderShelf(data);
    _showShelf();
    return true;
  }

  /* 작품 화면 → 책장 복귀 (배지 최신화를 위해 재조회, 실패 시 캐시로) */
  async function returnToShelf() {
    const ctx = _ctx();
    if (!ctx) return false;
    _showShelf();
    if (_shelfData) _renderShelf(_shelfData);           /* 즉시 표시(캐시) */
    try {
      /* 코드로 연 세션이면 코드 자격으로(링크 공개 여부 무관), 링크 세션이면 classId(서버가 공개 검증) */
      const payload = ctx.code ? { classCode: ctx.code } : { classId: ctx.classId };
      const res = await _fns().httpsCallable('getClassShelf')(payload);
      if (res && res.data && res.data.ok) { _shelfData = res.data; _renderShelf(res.data); }
    } catch (e) { /* 캐시 유지 */ }
    return true;
  }

  function hasCtx() { return !!_ctx(); }

  /* ══════════════ 댓글 패널 ══════════════ */
  function _teamBase() {
    const p = (typeof ViewerState !== 'undefined' && ViewerState.project) ? ViewerState.project : null;
    if (!p || !p.classId || !p.teamName) return null;
    return { classId: p.classId, enc: encodeURIComponent(p.teamName) };
  }

  function _drawer() {
    if (_drawerEl && document.body.contains(_drawerEl)) return _drawerEl;
    _drawerEl = document.createElement('div');
    _drawerEl.id = 'comment-drawer';
    _drawerEl.className = 'hidden';
    document.body.appendChild(_drawerEl);
    return _drawerEl;
  }
  function closeComments() { _drawer().classList.add('hidden'); }
  function _savedCode() { try { return sessionStorage.getItem(SS_CODE) || ''; } catch (e) { return ''; } }

  async function toggleComments() {
    const d = _drawer();
    if (!d.classList.contains('hidden')) { d.classList.add('hidden'); return; }
    const base = _teamBase();
    if (!base) return;
    d.classList.remove('hidden');
    d.innerHTML = '<div class="cmt-loading">댓글을 불러오는 중...</div>';
    let items = [];
    try {
      const snap = await getViewerDb().ref(`classes/${base.classId}/teams/${base.enc}/comments`).once('value');
      const raw = snap.val() || {};
      items = Object.entries(raw)
        .map(([id, c]) => ({ id, name: (c && c.name) || '', text: (c && c.text) || '', at: (c && c.at) || 0 }))
        .filter(c => c.text)
        .sort((a, b) => a.at - b.at);
    } catch (e) { /* read 거부(비공개 등) → 빈 목록 */ }
    _renderComments(d, items);
  }

  function _renderComments(d, items) {
    const listHtml = items.length
      ? items.map(c => `
          <div class="cmt-item">
            <div class="cmt-who">${esc(c.name)}</div>
            <div class="cmt-txt">${esc(c.text)}</div>
          </div>`).join('')
      : '<div class="cmt-empty">아직 댓글이 없어요.</div>';
    /* COMMENT-DISABLED-GUIDE(#28): 댓글 기능이 꺼진 학급이면 이름·내용·코드칸과 [댓글 남기기]를
       다 보여주고 '첫 한마디 남겨볼래요?'로 유도한 뒤 다 적고 나서야 서버 오류로 실패하던 것 →
       작성 폼 대신 안내만 표시(읽기는 그대로). commentEnabled는 getClassShelf 응답에 이미 포함. */
    const _cmtEnabled = !!(_shelfData && _shelfData.commentEnabled === true);
    const formHtml = _cmtEnabled
      ? `<div class="cmt-form">
        <input class="cmt-name" placeholder="이름" maxlength="12" value="">
        <textarea class="cmt-text" rows="2" placeholder="따뜻한 한마디를 남겨주세요 (200자)" maxlength="200"></textarea>
        <input class="cmt-code" placeholder="댓글 코드 — 선생님에게 받을 수 있어요" maxlength="10" value="${esc(_savedCode())}">
        <div class="cmt-err" aria-live="polite"></div>
        <button type="button" class="cmt-send">댓글 남기기</button>
      </div>`
      : `<div class="cmt-empty" style="margin-top:6px;">선생님이 댓글 기능을 켜면 한마디 남길 수 있어요.</div>`;
    d.innerHTML = `
      <div class="cmt-head">
        <span>💬 이 책의 댓글 <b>${items.length}</b></span>
        <button type="button" class="cmt-close" aria-label="닫기">✕</button>
      </div>
      <div class="cmt-note">따뜻한 말로 남겨요 · 이상한 댓글은 선생님이 지울 수 있어요</div>
      <div class="cmt-list">${listHtml}</div>
      ${formHtml}`;
    d.querySelector('.cmt-close').addEventListener('click', () => d.classList.add('hidden'));
    const _sendBtn = d.querySelector('.cmt-send');
    if (_sendBtn) _sendBtn.addEventListener('click', async () => {
      const base = _teamBase();
      if (!base) return;
      const name = d.querySelector('.cmt-name').value.trim();
      const text = d.querySelector('.cmt-text').value.trim();
      const code = d.querySelector('.cmt-code').value.trim();
      const errEl = d.querySelector('.cmt-err');
      const btn = d.querySelector('.cmt-send');
      errEl.textContent = '';
      if (!name) { errEl.textContent = '이름을 적어주세요.'; return; }
      if (!text) { errEl.textContent = '댓글 내용을 적어주세요.'; return; }
      if (!code) { errEl.textContent = '댓글 코드를 입력해주세요. (선생님에게 받을 수 있어요)'; return; }
      btn.disabled = true; btn.textContent = '남기는 중...';
      try {
        await _fns().httpsCallable('postWorkComment')({
          classId: base.classId, team: base.enc, code, name, text,
        });
        try { sessionStorage.setItem(SS_CODE, code); } catch (e) {}
        d.classList.add('hidden');
        toggleComments();   /* 닫았다 다시 열며 목록 새로 읽기(방금 단 댓글 반영) */
      } catch (e) {
        btn.disabled = false; btn.textContent = '댓글 남기기';
        const m = (e && e.message) || '';
        errEl.textContent = /[가-힣]/.test(m) ? m : '댓글을 남기지 못했어요. 잠시 후 다시 시도해 주세요.';
      }
    });
  }

  window.BranchShelf = { openShelf, returnToShelf, hasCtx, toggleComments, closeComments };
})();
