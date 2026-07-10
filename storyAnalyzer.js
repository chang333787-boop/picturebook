/* ================================================================
   storyAnalyzer.js — 이야기 구조 분석 + 루트 탐색
   의존: state.js (scenes)

   설계 원칙:
   - analyze* 함수: DOM 접근 없는 pure function — 데이터만 받아 결과 반환
   - render* 함수: 분석 결과를 DOM에 표시하는 역할만
   - 이 분리로 로직 변경 시 UI 코드를 건드리지 않아도 됨
   ================================================================ */

/* ================================================================
   PURE FUNCTIONS — DOM 접근 없음, 테스트 가능
   ================================================================ */

/* ================================================================
   entry/replay 해석 헬퍼 (admin/분석 문구 정리 1차)
   ─────────────────────────────────────────────────────────────
   · projectMeta.entrySceneId를 우선 사용
   · 없으면 하위 호환으로 기존 start scene 번호 fallback
   · 실제 scenes에 존재하지 않는 id면 null 반환 (유효성 체크용)
   · maker 쪽 전역 projectMeta(state.js) 참조
   ================================================================ */
function _resolveEntryNum() {
  const pm = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  if (pm.entrySceneId && scenes[pm.entrySceneId]) return Number(pm.entrySceneId);
  const start = Object.values(scenes).find(s => s.type === 'start');
  return start ? Number(start.num) : null;
}
function _resolveReplayNum() {
  const pm = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  if (pm.replaySceneId && scenes[pm.replaySceneId]) return Number(pm.replaySceneId);
  return _resolveEntryNum();
}
function _sceneRolesMaker(scene) {
  const pm = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  const id = String(scene.num);
  return {
    isEntry:  pm.entrySceneId  && String(pm.entrySceneId)  === id,
    isReplay: pm.replaySceneId && String(pm.replaySceneId) === id,
  };
}

/* ================================================================
   _getOutgoingIds — 한 장면의 다음 장면 id 목록 (CHECK-BUTTONS-1)
   ─────────────────────────────────────────────────────────────
   findAllRoutes의 분기 추출과 동일 우선순위로 outgoing을 판정.
   · buttons[]가 있으면 buttons 기준 (최대 6개, nextId 있는 것만)
   · buttons[]가 없으면 legacy nextA/nextB fallback
       - nextA: 항상
       - nextB: choiceCount > 1 일 때만
   · 반환은 문자열 id 배열. 존재 여부 필터는 호출 측에서 (broken은 별도 검사).
   ※ DOM 접근 없음 — scene 객체만 참조 */
function _getOutgoingIds(scene) {
  if (!scene) return [];
  if (Array.isArray(scene.buttons) && scene.buttons.length) {
    return scene.buttons
      .slice(0, 6)
      .map(b => b && b.nextId)
      .filter(Boolean)
      .map(String);
  }
  const out = [];
  if (scene.nextA) out.push(String(scene.nextA));
  if ((scene.choiceCount || 2) > 1 && scene.nextB) out.push(String(scene.nextB));
  return out;
}

/* 모든 루트를 DFS로 탐색해 반환
   반환: [ [ step, ... ], ... ]
   step 종류:
     { scene }                — 장면 방문
     { choice, choiceLabel }  — 선택 전환
     { loop: true, loopBackTo: N } — 경로 내 재방문 감지(경로 종료)
     { broken: true, brokenNum: N } — 존재하지 않는 장면 가리킴(경로 종료)
   ※ DOM 접근 없음 — scenes 객체만 참조
   startNum 인자: 지정하면 그 장면부터, 없으면 entrySceneId fallback */
const ROUTE_MAX_PATHS = 500;   // 전체 경로 상한 (루프/폭발 보호)

function findAllRoutes(startNum = null) {
  if (startNum == null) startNum = _resolveEntryNum();
  if (startNum == null) return [];
  const routes = [];

  function dfs(num, path, visitedInPath) {
    if (routes.length >= ROUTE_MAX_PATHS) return;

    /* 경로 내 재방문 → 루프로 표시하고 경로 종료 */
    if (visitedInPath.has(num)) {
      routes.push([...path, { loop: true, loopBackTo: num }]);
      return;
    }
    const s = scenes[num];
    if (!s) {
      routes.push([...path, { broken: true, brokenNum: num }]);
      return;
    }
    visitedInPath = new Set(visitedInPath); visitedInPath.add(num);
    const newPath = [...path, { scene: s }];

    if (s.type === 'ending') { routes.push(newPath); return; }

    /* 한 장면의 모든 분기를 buttons[] 또는 legacy nextA/B에서 추출 (B-단계 N개 처리).
       각 항목: { idx, portChar, label, nextNum (있으면), broken (없거나 잘림) } */
    const branches = [];
    const buttonsList = Array.isArray(s.buttons) ? s.buttons : [];
    if (buttonsList.length > 0) {
      /* 새 구조: buttons[] 우선 — 최대 6개 */
      buttonsList.slice(0, 6).forEach((b, i) => {
        if (!b) return;
        const portChar = String.fromCharCode(65 + i);
        const label = (b.label && b.label.trim()) ? b.label : `선택지 ${portChar}`;
        if (b.nextId) {
          if (scenes[b.nextId]) branches.push({ portChar, label, nextNum: b.nextId });
          else                  branches.push({ portChar, label, broken: b.nextId });
        }
        /* nextId 없으면 미연결 — branches에 추가 안 함 (감상에서 안 보임) */
      });
    } else {
      /* legacy: nextA/B + choiceCount */
      const cnt  = s.choiceCount || 2;
      const hasA = s.nextA && scenes[s.nextA];
      const brokenA = s.nextA && !scenes[s.nextA];
      if (cnt === 1) {
        if (hasA) branches.push({ portChar: '→', label: '', nextNum: s.nextA });
        else if (brokenA) branches.push({ portChar: '→', label: '', broken: s.nextA });
      } else {
        if (hasA) branches.push({ portChar: 'A', label: s.choiceA || '선택지 A', nextNum: s.nextA });
        else if (brokenA) branches.push({ portChar: 'A', label: s.choiceA || '선택지 A', broken: s.nextA });
        const hasB = s.nextB && scenes[s.nextB];
        const brokenB = s.nextB && !scenes[s.nextB];
        if (hasB) branches.push({ portChar: 'B', label: s.choiceB || '선택지 B', nextNum: s.nextB });
        else if (brokenB) branches.push({ portChar: 'B', label: s.choiceB || '선택지 B', broken: s.nextB });
      }
    }

    if (branches.length === 0) {
      /* 다음 장면 없음 (엔딩 아닌데 분기도 없음) */
      routes.push(newPath);
      return;
    }

    branches.forEach((br, brIdx) => {
      /* v130: 인라인 수정을 위해 choiceIndex + fromSceneNum 기록.
         legacy nextA/B 분기는 buttonsList가 없는 경우 — choiceIndex는
         portChar('A'=0,'B'=1)로 매핑. buttons[] 분기는 buttonsList의 idx 그대로. */
      const choiceIdx = (buttonsList.length > 0)
        ? brIdx
        : (br.portChar === 'A' ? 0 : br.portChar === 'B' ? 1 : 0);
      if (br.broken) {
        routes.push([...newPath,
          { choice: br.portChar, choiceLabel: br.label, fromSceneNum: Number(num), choiceIndex: choiceIdx },
          { broken: true, brokenNum: br.broken },
        ]);
      } else if (br.nextNum) {
        dfs(Number(br.nextNum),
          [...newPath, { choice: br.portChar, choiceLabel: br.label, fromSceneNum: Number(num), choiceIndex: choiceIdx }],
          visitedInPath);
      }
    });
  }
  dfs(Number(startNum), [], new Set());
  return routes;
}

/* 구조 문제를 분석해 항목 배열로 반환 — DOM 수정 없음
   반환: [ { cls: 'check-ok'|'check-warn'|'check-error'|'check-divider', msg: string, errorNums?: number[] } ]

   검사 기준 (admin/분석 문구 정리 1차):
   · 첫 감상 시작점: projectMeta.entrySceneId 또는 start scene fallback
   · 다시 시작점: projectMeta.replaySceneId 또는 entry와 동일
   · 두 값이 실제 scenes에 존재하는 장면을 가리켜야 함
   · 엔딩 장면 존재 여부
   · 엔트리 기준 도달 가능성 / 연결 구조 */
function analyzeStructure() {
  const items    = [];
  const sceneArr = Object.values(scenes);

  if (!sceneArr.length) {
    return [{ cls: 'check-warn', msg: '⚠️ 장면이 없어요.' }];
  }

  const pm            = (typeof projectMeta === 'object' && projectMeta) ? projectMeta : {};
  const entryNum      = _resolveEntryNum();
  const replayNum     = _resolveReplayNum();
  const entryExplicit = !!(pm.entrySceneId && scenes[pm.entrySceneId]);
  const replayExplicit= !!(pm.replaySceneId && scenes[pm.replaySceneId]);
  const entryMetaSet  = pm.entrySceneId  !== null && pm.entrySceneId  !== undefined && pm.entrySceneId  !== '';
  const replayMetaSet = pm.replaySceneId !== null && pm.replaySceneId !== undefined && pm.replaySceneId !== '';

  const endings = sceneArr.filter(s => s.type === 'ending');

  /* ── 처음 시작 장면 ── */
  if (entryNum == null) {
    items.push({ cls: 'check-error', msg: '❌ 처음 시작 장면이 지정되지 않았어요.' });
  } else if (entryMetaSet && !entryExplicit) {
    items.push({ cls: 'check-error', msg: `❌ 처음 시작 장면이 존재하지 않는 장면을 가리켜요 (장면 ${pm.entrySceneId}).` });
  } else if (!entryExplicit) {
    items.push({ cls: 'check-warn', msg: `⚠️ 처음 시작 장면이 지정되지 않아 자동으로 장면 ${entryNum}에서 시작해요.` });
  } else {
    items.push({ cls: 'check-ok', msg: `✅ 처음 시작 장면: 장면 ${entryNum}` });
  }

  /* ── 다시 할 때 시작 장면 ── */
  if (replayNum == null) {
    items.push({ cls: 'check-error', msg: '❌ 다시 할 때 시작 장면이 지정되지 않았어요.' });
  } else if (replayMetaSet && !replayExplicit) {
    items.push({ cls: 'check-error', msg: `❌ 다시 할 때 시작 장면이 존재하지 않는 장면을 가리켜요 (장면 ${pm.replaySceneId}).` });
  } else if (!replayExplicit) {
    items.push({ cls: 'check-warn', msg: `⚠️ 다시 할 때 시작 장면이 지정되지 않아 처음 시작 장면(장면 ${replayNum})과 동일하게 동작해요.` });
  } else {
    items.push({ cls: 'check-ok', msg: `✅ 다시 할 때 시작 장면: 장면 ${replayNum}` });
  }

  /* ── 엔딩 ── */
  if (!endings.length) items.push({ cls: 'check-error', msg: '❌ 엔딩 장면이 없어요.' });
  else items.push({ cls: 'check-ok', msg: `✅ 엔딩: ${endings.length}개 (${endings.map(e => e.num).join(', ')})` });

  /* ── 연결 검사 (엔딩 아닌 장면 중 다음이 없는 것) ──
     CHECK-BUTTONS-1: buttons[].nextId 기반 작품도 인식 (legacy nextA/nextB fallback 유지). */
  const noConn = sceneArr.filter(s => s.type !== 'ending' && _getOutgoingIds(s).length === 0);
  if (noConn.length) {
    items.push({
      cls: 'check-warn',
      msg: `⚠️ 다음 장면이 없는 장면: ${noConn.map(s => s.num).join(', ')}`,
      errorNums: noConn.map(s => s.num)
    });
  } else {
    items.push({ cls: 'check-ok', msg: '✅ 모든 장면의 다음이 연결돼 있어요.' });
  }

  /* ── 존재하지 않는 장면을 가리키는 링크 ──
     CHECK-BUTTONS-1: buttons[].nextId 도 broken 검사 (legacy nextA/nextB fallback은 helper가 처리). */
  const broken = [];
  sceneArr.forEach(s => {
    _getOutgoingIds(s).forEach(id => {
      if (!scenes[id]) broken.push(`장면 ${s.num} → 없는 장면 ${id}`);
    });
  });
  broken.forEach(b => items.push({ cls: 'check-error', msg: '❌ ' + b }));

  /* ── 처음 시작 장면에서 도달 불가능한 장면 ── */
  if (entryNum != null) {
    const reachable = new Set();
    const stack = [entryNum];
    while (stack.length) {
      const n = stack.pop();
      if (reachable.has(n)) continue;
      const s = scenes[n];
      if (!s) continue;
      reachable.add(n);
      /* CHECK-BUTTONS-1: buttons[].nextId 까지 따라가 도달 가능성 계산 (legacy fallback 포함). */
      _getOutgoingIds(s).forEach(id => { if (scenes[id]) stack.push(Number(id)); });
    }
    const unreachable = sceneArr.filter(s => !reachable.has(Number(s.num)));
    if (unreachable.length) {
      items.push({
        cls: 'check-warn',
        msg: `⚠️ 처음 시작 장면에서 도달할 수 없는 장면이 ${unreachable.length}개 있어요: ${unreachable.map(s => s.num).join(', ')}`,
        errorNums: unreachable.map(s => s.num)
      });
    }
  }

  /* ── 루트 깊이 분석 ── */
  const routes = findAllRoutes();
  if (routes.length > 0) {
    const endingRoutes  = routes.filter(r => r[r.length-1].scene?.type === 'ending');
    const sceneCounts   = routes.map(r => r.filter(step => step.scene).length);
    const minLen        = Math.min(...sceneCounts), maxLen = Math.max(...sceneCounts);
    /* CHECK-BUTTONS-1: 갈림길 = 유효한(존재하는) 다음 장면이 2개 이상 (buttons[]/legacy 공통). */
    const branchPoints  = sceneArr.filter(s =>
      s.type !== 'ending' && _getOutgoingIds(s).filter(id => scenes[id]).length >= 2);
    const shortRoutes   = routes.filter(r => r.filter(s => s.scene).length <= 3);

    items.push({ cls: 'check-divider', msg: '── 작품 깊이 분석 ──' });

    if (!endingRoutes.length)        items.push({ cls: 'check-error', msg: '❌ 엔딩에 도달하는 루트가 없어요.' });
    else if (endingRoutes.length===1)items.push({ cls: 'check-warn',  msg: '⚠️ 엔딩이 1개뿐이에요. 다른 결말을 추가하면 더 재미있어요!' });
    else                             items.push({ cls: 'check-ok',    msg: `✅ 루트가 ${endingRoutes.length}개예요. 다양한 결말이 있어요!` });

    if (maxLen <= 2)       items.push({ cls: 'check-warn', msg: '⚠️ 이야기가 너무 짧아요. 장면을 더 이어 붙여보세요!' });
    else if (maxLen <= 4)  items.push({ cls: 'check-warn', msg: `⚠️ 가장 긴 루트가 ${maxLen}장면이에요. 조금 더 깊게 만들어보세요!` });
    else                   items.push({ cls: 'check-ok',   msg: `✅ 가장 긴 루트: ${maxLen}장면 / 가장 짧은 루트: ${minLen}장면` });

    if (shortRoutes.length > 0 && routes.length > 1)
      items.push({ cls: 'check-warn', msg: `⚠️ 3장면 이하로 끝나는 루트가 ${shortRoutes.length}개 있어요.` });

    if (!branchPoints.length) items.push({ cls: 'check-warn', msg: '⚠️ 진짜 갈림길이 없어요! 선택지 A/B를 모두 연결해 보세요.' });
    else                      items.push({ cls: 'check-ok',   msg: `✅ 갈림길: ${branchPoints.length}곳` });
  }

  return items;
}

/* ================================================================
   RENDER FUNCTIONS — 분석 결과를 DOM에 표시
   ================================================================ */

function checkStructure() {
  const panel  = document.getElementById('check-panel');
  const result = document.getElementById('check-result');
  panel.style.display = 'block';

  /* DOM 조작: 이전 에러 표시 초기화 */
  document.querySelectorAll('.scene-card').forEach(el => el.classList.remove('error-card'));

  const items = analyzeStructure();

  /* errorNums가 있는 항목만 DOM에 error-card 클래스 추가 */
  items.forEach(item => {
    if (item.errorNums) {
      item.errorNums.forEach(n => document.getElementById('card-' + n)?.classList.add('error-card'));
    }
  });

  result.innerHTML = items.map(i =>
    i.cls === 'check-divider'
      ? `<div style="text-align:center;color:var(--muted);font-size:11px;margin:8px 0 4px;">${i.msg}</div>`
      : `<div class="check-item ${i.cls}">${i.msg}</div>`
  ).join('');
}

/* ================================================================
   루트보기 — 엔딩별 흐름 점검 도구
   ─────────────────────────────────────────────────────────────
   · 상단: 시작 기준 토글 (첫 감상 / 다시 시작)
   · 본문: 엔딩별로 그룹화된 경로 목록
   · 각 경로: 단락형 — '장면 N. 제목' + '-선택지-' 줄 교차
   · 루프/끊김 감지, 엔딩당 20개 제한
   · 장면 줄 클릭 시 해당 카드로 점프(패널 닫고 스크롤)
   ================================================================ */

const ROUTES_PER_ENDING_CAP = 20;   // 엔딩당 표시 경로 수 상한
let _routeMode = 'entry';            // 'entry' | 'replay'

/* ── HTML escape ── */
function _rtEsc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* ── 장면 한 줄 미리보기 텍스트 (v118: 본문 우선, title은 fallback) ──
   사용자 명령: 루트보기에 보이는 것 = 본문(body) 요약이어야. 옛엔 title만 표시
   → 학생들이 body를 적은 후에도 '(내용 없음)'으로 남아 있었음.
   분기:
   · 표지(cover): title 또는 subtitle 사용 (cover엔 body 없음)
   · 일반/엔딩: body 우선, body 없으면 title (legacy 호환 — 옛 작품은 title에 본문을 적은 경우) */
function _rtPreviewText(scene) {
  if (!scene) return '(내용 없음)';
  const isCover = (scene.type === 'cover' || scene.isCover);
  let raw;
  if (isCover) {
    raw = String(scene.title || scene.subtitle || '').trim();
  } else {
    raw = String(scene.body || scene.title || '').trim();
  }
  if (!raw) return '(내용 없음)';
  /* 줄바꿈은 공백으로 합치고 앞 80자까지 */
  const oneLine = raw.replace(/\s+/g, ' ');
  return oneLine.length > 80 ? oneLine.slice(0, 80) + '…' : oneLine;
}

/* ── 장면 행 prefix — 번호 + 역할/엔딩 표시 ── */
function _rtScenePrefix(scene) {
  const roles   = _sceneRolesMaker(scene);
  const isEnd   = scene.type === 'ending';
  const isTrue  = isEnd && scene.trueEnding;
  if (isTrue)         return `장면 ${scene.num} · ⭐ 진엔딩`;
  if (isEnd)          return `장면 ${scene.num} · 🏁 엔딩`;
  if (roles.isEntry)  return `장면 ${scene.num} · 🟢 처음 시작 장면`;
  if (roles.isReplay) return `장면 ${scene.num} · 🔁 다시 할 때 시작 장면`;
  return `장면 ${scene.num}`;
}

/* ── 시작 기준 장면 번호 (현재 _routeMode 기준) ── */
function _rtCurrentStart() {
  return _routeMode === 'replay' ? _resolveReplayNum() : _resolveEntryNum();
}

/* ── v130: 인라인 수정 가능 여부 판단 ──
   viewer-edit 환경(ViewerState + _queueSave + _editText)에서만 동작.
   _editText.editable=true인 경우만 ✎ 표시. 잠금/내가 수정하기 전엔 표시 안 함.
   maker 환경에선 _editText가 없음 — false 반환 (v130 = viewer-edit 한정).
   v134: body.viewer-edit-readonly가 있는 경우 추가 차단 (v129 정책 정합).
         두 검사 모두 통과해야 ✎ 표시 — 안전망 강화. */
function _rtIsViewerEditable() {
  if (typeof window === 'undefined') return false;
  if (typeof window.ViewerState === 'undefined') return false;
  if (typeof window._editText === 'undefined') return false;
  if (typeof window._queueSave !== 'function' && typeof window.saveSceneText !== 'function') return false;
  /* v134: body class가 있는 경우 차단 (v129 readonly 정책 일관) */
  if (typeof document !== 'undefined' && document.body &&
      document.body.classList.contains('viewer-edit-readonly')) {
    return false;
  }
  return !!window._editText.editable;
}

/* ── v130: 본문/행동버튼 저장 라우터 ──
   현재 다듬기 중인 장면이면 _queueSave (debounce + 잠금 heartbeat 포함).
   다른 장면이면 saveSceneText 직접 호출 (debounce 없음 — blur 후 1회만 저장).
   v134: 저장 실패 시 onFailure 콜백 호출 — 호출자가 메모리 롤백 + 화면 안내를 할 수 있게. */
function _rtPersistSave(sceneNum, fields, onFailure) {
  const num = Number(sceneNum);
  const editingNum = (window._editText && window._editText.num != null)
    ? Number(window._editText.num) : null;
  if (editingNum === num && typeof window._queueSave === 'function') {
    /* _queueSave는 debounce — 즉시 실패 감지 어렵지만 _flushPendingSave가
       saveSceneText 호출 시 실패를 status banner로 알림. 여기선 정상 path. */
    window._queueSave(num, fields);
    return;
  }
  if (typeof window.saveSceneText === 'function') {
    window.saveSceneText(num, fields).catch(err => {
      console.error('[rt save] 실패:', err);
      if (typeof onFailure === 'function') {
        try { onFailure(err); } catch (e) { /* noop */ }
      }
      try { alert('저장에 실패했어요. 인터넷 연결을 확인해 주세요.\n원본 값으로 되돌아갑니다.'); } catch (e) { /* noop */ }
    });
  }
}

/* ── v130: 메모리 상태 동기화 (window.scenes + ViewerState.scenes 둘 다 갱신) ──
   viewer-edit의 adapter는 ViewerState.scenes → window.scenes로 복사하는데 spread라
   객체가 다름. 따라서 두 곳 모두 갱신해야 다음 렌더가 정합. */
function _rtSyncSceneField(sceneNum, fieldName, value) {
  if (typeof scenes !== 'undefined' && scenes[sceneNum]) {
    scenes[sceneNum][fieldName] = value;
  }
  if (typeof window !== 'undefined' && window.ViewerState && window.ViewerState.scenes) {
    const vId = String(sceneNum);
    if (window.ViewerState.scenes[vId]) {
      window.ViewerState.scenes[vId][fieldName] = value;
    }
  }
}

/* ── v130: 본문 저장 — 인라인 textarea blur/Enter 후 호출 ──
   v134: 저장 실패 시 메모리/패널/viewer-frame 모두 옛 값으로 롤백 — 화면-DB 불일치 차단. */
function _rtSaveBody(sceneNum, value) {
  /* v127 정책 유지: trim 하지 않음 — \n\n 등 줄바꿈 그대로 보존 */
  /* v134: 옛 값을 저장 전에 롤백용으로 보관 */
  const prevBody = (typeof scenes !== 'undefined' && scenes[sceneNum])
    ? String(scenes[sceneNum].body || '') : '';

  _rtSyncSceneField(sceneNum, 'body', value);
  _rtPersistSave(sceneNum, { body: value }, () => {
    /* 저장 실패 — 메모리/UI 옛 값으로 되돌림 */
    _rtSyncSceneField(sceneNum, 'body', prevBody);
    const editingNum2 = (window._editText && window._editText.num != null)
      ? Number(window._editText.num) : null;
    if (editingNum2 === Number(sceneNum) && typeof window._patchSceneBody === 'function') {
      window._patchSceneBody(prevBody);
    }
    const panel2 = document.getElementById('edit-panel');
    if (panel2 && editingNum2 === Number(sceneNum)) {
      const bodyInput2 = panel2.querySelector('.js-edit-body');
      if (bodyInput2 && document.activeElement !== bodyInput2) {
        bodyInput2.value = prevBody;
      }
    }
    /* 루트보기 통째 재렌더 — 같은 sceneId가 쓰인 곳 모두 옛 값으로 */
    if (typeof renderRoutePanel === 'function') renderRoutePanel();
  });

  /* viewer-frame 현재 장면이면 즉시 patch — 깜빡임 차단 */
  const editingNum = (window._editText && window._editText.num != null)
    ? Number(window._editText.num) : null;
  if (editingNum === Number(sceneNum) && typeof window._patchSceneBody === 'function') {
    window._patchSceneBody(value);
  }
  /* 다듬기 패널 본문 textarea 갱신 (사용자가 입력 중이 아닐 때만) */
  const panel = document.getElementById('edit-panel');
  if (panel && editingNum === Number(sceneNum)) {
    const bodyInput = panel.querySelector('.js-edit-body');
    if (bodyInput && document.activeElement !== bodyInput) {
      bodyInput.value = value;
    }
  }
}

/* ── v130: 선택지 라벨 저장 ──
   v134: 저장 실패 시 buttons/choiceA·B 모두 옛 값으로 롤백. */
function _rtSaveChoiceLabel(sceneNum, choiceIdx, value) {
  const num = Number(sceneNum);
  const idx = Number(choiceIdx);

  /* v134: 옛 값 스냅샷 — 실패 시 롤백용 */
  const prevSnapshot = (typeof scenes !== 'undefined' && scenes[num])
    ? {
        buttons: Array.isArray(scenes[num].buttons)
          ? scenes[num].buttons.map(b => ({ ...b }))
          : [],
        choiceA: scenes[num].choiceA || '',
        choiceB: scenes[num].choiceB || '',
        choiceCount: scenes[num].choiceCount || 0,
      }
    : null;
  const prevViewerLabel = (window.ViewerState && window.ViewerState.scenes &&
                           window.ViewerState.scenes[String(num)] &&
                           Array.isArray(window.ViewerState.scenes[String(num)].choices) &&
                           window.ViewerState.scenes[String(num)].choices[idx])
    ? window.ViewerState.scenes[String(num)].choices[idx].label
    : '';

  /* maker 형식 buttons[] 갱신 */
  if (typeof scenes !== 'undefined' && scenes[num]) {
    const s = scenes[num];
    if (!Array.isArray(s.buttons)) s.buttons = [];
    while (s.buttons.length <= idx) s.buttons.push({ label: '', nextId: null });
    s.buttons[idx] = { ...(s.buttons[idx] || {}), label: value };
    /* choiceA/B 호환 동기화 (maker UI가 사용하는 필드) */
    if (idx === 0) s.choiceA = value;
    if (idx === 1) s.choiceB = value;
  }

  /* ViewerState.scenes 동기화 — adapter가 choices 배열을 사용 */
  if (typeof window !== 'undefined' && window.ViewerState && window.ViewerState.scenes) {
    const vs = window.ViewerState.scenes[String(num)];
    if (vs && Array.isArray(vs.choices) && vs.choices[idx]) {
      vs.choices[idx].label = value;
    }
  }

  /* Firebase 저장 — buttons 전체 + choiceA/B 동기화 (viewer-data.js ALLOWED에 포함됨) */
  const buttons = (typeof scenes !== 'undefined' && scenes[num] && Array.isArray(scenes[num].buttons))
    ? scenes[num].buttons : [];
  const patch = { buttons };
  if (idx === 0) patch.choiceA = value;
  if (idx === 1) patch.choiceB = value;
  patch.choiceCount = buttons.length;
  _rtPersistSave(num, patch, () => {
    /* v134: 저장 실패 — 옛 값 복원 */
    if (prevSnapshot && typeof scenes !== 'undefined' && scenes[num]) {
      scenes[num].buttons = prevSnapshot.buttons;
      scenes[num].choiceA = prevSnapshot.choiceA;
      scenes[num].choiceB = prevSnapshot.choiceB;
      scenes[num].choiceCount = prevSnapshot.choiceCount;
    }
    if (window.ViewerState && window.ViewerState.scenes) {
      const vs2 = window.ViewerState.scenes[String(num)];
      if (vs2 && Array.isArray(vs2.choices) && vs2.choices[idx]) {
        vs2.choices[idx].label = prevViewerLabel;
      }
    }
    const editingNum2 = (window._editText && window._editText.num != null)
      ? Number(window._editText.num) : null;
    if (editingNum2 === num && typeof window._scheduleViewerFrameReRender === 'function') {
      window._scheduleViewerFrameReRender();
    }
    const panel2 = document.getElementById('edit-panel');
    if (panel2 && editingNum2 === num) {
      const labelInput2 = panel2.querySelector(`.js-edit-button-label[data-idx="${idx}"]`);
      if (labelInput2 && document.activeElement !== labelInput2) {
        labelInput2.value = prevViewerLabel;
      }
    }
    if (typeof renderRoutePanel === 'function') renderRoutePanel();
  });

  /* viewer-frame 현재 장면이면 통째 재렌더 — 행동버튼 라벨 patch 없음.
     _patchSceneBody 같은 부분 patch가 없어 통째 재렌더로 처리. */
  const editingNum = (window._editText && window._editText.num != null)
    ? Number(window._editText.num) : null;
  if (editingNum === num && typeof window._scheduleViewerFrameReRender === 'function') {
    window._scheduleViewerFrameReRender();
  }

  /* 다듬기 패널 행동버튼 input 갱신 */
  const panel = document.getElementById('edit-panel');
  if (panel && editingNum === num) {
    const labelInput = panel.querySelector(`.js-edit-button-label[data-idx="${idx}"]`);
    if (labelInput && document.activeElement !== labelInput) {
      labelInput.value = value;
    }
  }
}

/* ── v130: 인라인 편집 진입 — 본문 ── */
function _rtEnterEditBody(sceneLine) {
  if (!_rtIsViewerEditable()) return;
  const num = Number(sceneLine.dataset.num);
  if (!Number.isFinite(num) || !scenes[num]) return;
  /* 이미 편집 중인 textarea 있으면 중복 진입 안 함 */
  if (sceneLine.querySelector('.rt-inline-body-editor')) return;

  const scene = scenes[num];
  const original = String(scene.body || '');

  /* 기존 prefix/text/✎ 숨기고 textarea + 저장/취소 버튼 표시 */
  const prefixEl = sceneLine.querySelector('.rt-scene-prefix');
  const textEl   = sceneLine.querySelector('.rt-scene-text');
  const editBtn  = sceneLine.querySelector('.js-rt-edit-body');
  if (textEl) textEl.style.display = 'none';
  if (editBtn) editBtn.style.display = 'none';

  const wrap = document.createElement('div');
  wrap.className = 'rt-inline-editor-wrap';
  wrap.innerHTML = `
    <textarea class="rt-inline-body-editor" data-scene-num="${num}" rows="4"
      placeholder="장면 본문을 적어주세요">${_rtEsc(original)}</textarea>
    <div class="rt-inline-editor-actions">
      <span class="rt-inline-editor-hint">Ctrl+Enter 저장 · Esc 취소</span>
      <button class="rt-inline-editor-btn rt-inline-editor-btn--cancel js-rt-cancel-body" type="button">취소</button>
      <button class="rt-inline-editor-btn rt-inline-editor-btn--save js-rt-save-body" type="button">저장</button>
    </div>`;
  sceneLine.appendChild(wrap);

  const ta = wrap.querySelector('.rt-inline-body-editor');
  ta.focus();
  /* 커서를 끝으로 이동 */
  try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) { /* noop */ }
}

/* ── v130: 인라인 편집 진입 — 선택지 라벨 ── */
function _rtEnterEditChoice(choiceLine) {
  if (!_rtIsViewerEditable()) return;
  const num = Number(choiceLine.dataset.sceneNum);
  const idx = Number(choiceLine.dataset.choiceIndex);
  if (!Number.isFinite(num) || !Number.isFinite(idx) || !scenes[num]) return;
  if (choiceLine.querySelector('.rt-inline-choice-editor')) return;

  const s = scenes[num];
  const buttons = Array.isArray(s.buttons) ? s.buttons : [];
  const cur = (buttons[idx] && buttons[idx].label) ||
              (idx === 0 ? (s.choiceA || '') : idx === 1 ? (s.choiceB || '') : '');

  const textEl = choiceLine.querySelector('.rt-choice-text');
  const editBtn = choiceLine.querySelector('.js-rt-edit-choice');
  if (textEl) textEl.style.display = 'none';
  if (editBtn) editBtn.style.display = 'none';

  const wrap = document.createElement('span');
  wrap.className = 'rt-inline-editor-wrap rt-inline-editor-wrap--choice';
  wrap.innerHTML = `
    <input class="rt-inline-choice-editor" type="text" maxlength="60"
      data-scene-num="${num}" data-choice-index="${idx}"
      value="${_rtEsc(cur)}" placeholder="선택지 라벨">
    <button class="rt-inline-editor-btn rt-inline-editor-btn--cancel js-rt-cancel-choice" type="button">취소</button>
    <button class="rt-inline-editor-btn rt-inline-editor-btn--save js-rt-save-choice" type="button">저장</button>`;
  choiceLine.appendChild(wrap);

  const input = wrap.querySelector('.rt-inline-choice-editor');
  input.focus();
  try { input.setSelectionRange(input.value.length, input.value.length); } catch (e) { /* noop */ }
}

/* ── v130: 편집 종료 — 저장 또는 취소 ── */
function _rtFinishEditBody(sceneLine, save) {
  const ta = sceneLine.querySelector('.rt-inline-body-editor');
  if (!ta) return;
  const num = Number(ta.dataset.sceneNum);
  if (save && Number.isFinite(num)) {
    /* v127 정책 — textarea.value 그대로 (trim 하지 않음) */
    _rtSaveBody(num, ta.value);
  }
  /* 통째 재렌더 — 같은 sceneId가 쓰인 모든 곳 자동 갱신 */
  renderRoutePanel();
}

function _rtFinishEditChoice(choiceLine, save) {
  const input = choiceLine.querySelector('.rt-inline-choice-editor');
  if (!input) return;
  const num = Number(input.dataset.sceneNum);
  const idx = Number(input.dataset.choiceIndex);
  if (save && Number.isFinite(num) && Number.isFinite(idx)) {
    _rtSaveChoiceLabel(num, idx, input.value);
  }
  renderRoutePanel();
}

/* ── 경로 단락 HTML 생성 ──
   v130: 본문/행동버튼 라벨 인라인 수정 추가. viewer-edit 환경 + editable일 때만 ✎ 버튼 표시. */
function _rtPathHtml(path, pathIndex) {
  const canEdit = _rtIsViewerEditable();
  let body = '';
  path.forEach(step => {
    if (step.loop) {
      body += `<div class="rt-issue-line">🔁 반복 경로 감지 — 장면 ${step.loopBackTo}(으)로 돌아가 여기서 중단</div>`;
      return;
    }
    if (step.broken) {
      body += `<div class="rt-issue-line">🔌 존재하지 않는 장면 ${step.brokenNum}(을)를 가리킴</div>`;
      return;
    }
    if (step.choice !== undefined) {
      const lbl = step.choiceLabel || (step.choice === '→' ? '다음으로' : `선택지 ${step.choice}`);
      /* v130: 선택지 라벨 인라인 수정. fromSceneNum + choiceIndex가 담겨 있음 */
      const editBtn = (canEdit && step.fromSceneNum != null && step.choiceIndex != null)
        ? `<button class="rt-inline-edit-btn js-rt-edit-choice"
             data-scene-num="${step.fromSceneNum}" data-choice-index="${step.choiceIndex}"
             title="이 행동버튼 라벨 수정">✎</button>` : '';
      const dataAttrs = (step.fromSceneNum != null && step.choiceIndex != null)
        ? ` data-scene-num="${step.fromSceneNum}" data-choice-index="${step.choiceIndex}"` : '';
      body += `<div class="rt-choice-line"${dataAttrs}>
        <span class="rt-choice-text">- ${_rtEsc(lbl)} -</span>
        ${editBtn}
      </div>`;
      return;
    }
    /* scene step — 클릭 시 카드로 점프 */
    const s       = step.scene;
    const isEnd   = s.type === 'ending';
    const prefix  = _rtScenePrefix(s);
    const preview = _rtPreviewText(s);
    const cls     = isEnd ? 'rt-scene-line rt-scene-line--ending' : 'rt-scene-line';
    /* v130: 본문 수정 ✎ 표시. 엔딩도 본문 수정 가능 — 표지는 제외 (body가 없어 빈 textarea가 되므로) */
    const isCover = (s.type === 'cover' || s.isCover);
    const editBodyBtn = (canEdit && !isCover)
      ? `<button class="rt-inline-edit-btn js-rt-edit-body"
           data-scene-num="${s.num}"
           title="이 장면 본문 수정">✎</button>` : '';
    body += `<div class="${cls} js-rt-scene" data-num="${s.num}">
      <span class="rt-scene-prefix">${_rtEsc(prefix)}.</span>
      <span class="rt-scene-text" data-scene-num="${s.num}" title="클릭하면 해당 장면 카드로 이동">${_rtEsc(preview)}</span>
      ${editBodyBtn}
    </div>`;
  });

  return `<div class="rt-path">
    <div class="rt-path-label">경로 ${pathIndex + 1}</div>
    <div class="rt-path-steps">${body}</div>
  </div>`;
}

/* ── 엔딩별 그룹화 ──
   반환: [{ key, title, kind: 'ending'|'true-ending'|'issue-*', routes: Array<path>, endingNum? }] */
function _rtGroupByEnding(routes) {
  const groups = new Map();
  const keyOf = (path) => {
    const last = path[path.length - 1];
    if (last.loop)     return 'issue-loop';
    if (last.broken)   return 'issue-broken';
    if (last.scene?.type === 'ending') return 'ending-' + last.scene.num;
    return 'issue-dead';
  };
  routes.forEach(r => {
    const k = keyOf(r);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r);
  });

  const result = [];
  const keys = [...groups.keys()];
  /* 정렬: 진엔딩 먼저 → 일반 엔딩 (번호 오름차순) → 이슈 그룹 */
  keys.sort((a, b) => {
    const aEnd = a.startsWith('ending-'), bEnd = b.startsWith('ending-');
    if (aEnd !== bEnd) return aEnd ? -1 : 1;
    if (aEnd && bEnd) {
      const na = Number(a.slice(7)), nb = Number(b.slice(7));
      const sa = scenes[na], sb = scenes[nb];
      if (!!sa?.trueEnding !== !!sb?.trueEnding) return sa?.trueEnding ? -1 : 1;
      return na - nb;
    }
    return 0;
  });

  /* v134: 일반 엔딩은 정렬된 순서대로 1, 2, 3 번호 부여. 진엔딩은 별도 ⭐ 라벨.
     사용자 의도: "엔딩 1 · 장면 5" 형식 — 옛 "장면 5 · 장면 5" 중복 표기 해소. */
  let ordinaryEndingCount = 0;
  keys.forEach(k => {
    const rs = groups.get(k);
    if (k.startsWith('ending-')) {
      const n  = Number(k.slice(7));
      const sc = scenes[n];
      const isTrue = !!sc?.trueEnding;
      /* 일반 엔딩만 번호 부여 (진엔딩은 ⭐) */
      if (!isTrue) ordinaryEndingCount += 1;
      /* icon은 헤더 렌더에서 별도 ⭐/🏁 표시 — title에는 넣지 않음 (중복 방지) */
      const title = isTrue ? '진엔딩' : `엔딩 ${ordinaryEndingCount}`;
      result.push({
        key: k,
        kind: isTrue ? 'true-ending' : 'ending',
        endingNum: n,
        endingOrdinal: isTrue ? null : ordinaryEndingCount,
        title,
        routes: rs,
      });
    } else {
      const meta = {
        'issue-loop':   { title: '루프 때문에 중단된 경로', icon: '🔁' },
        'issue-broken': { title: '끊긴 연결을 만난 경로',   icon: '🔌' },
        'issue-dead':   { title: '엔딩에 도달하지 못한 경로', icon: '⚠️' },
      }[k];
      result.push({ key: k, kind: k, title: meta.title, icon: meta.icon, routes: rs });
    }
  });
  return result;
}

/* ── 루트보기 패널 오픈/닫기 ── */
function openRoutePanel() {
  document.getElementById('route-panel').style.display = 'flex';
  /* 패널 열 때마다 현재 구조로 다시 그림 */
  renderRoutePanel();
}

function closeRoutePanel() {
  document.getElementById('route-panel').style.display = 'none';
}

/* ── 메인 렌더 ── */
function renderRoutePanel() {
  const tabsEl    = document.getElementById('route-tabs');
  const contentEl = document.getElementById('route-content');
  if (!tabsEl || !contentEl) return;

  /* 상단 — 시작 기준 토글 */
  const entryNum  = _resolveEntryNum();
  const replayNum = _resolveReplayNum();
  const curStart  = _rtCurrentStart();

  const modeBtn = (mode, label, num) => {
    const active = _routeMode === mode;
    const bg     = active ? '#9b4dca' : '#fff';
    const color  = active ? '#fff'    : '#7030b0';
    const disabled = num == null;
    return `<button class="js-rt-mode" data-mode="${mode}" ${disabled ? 'disabled' : ''}
      style="padding:7px 14px;border-radius:50px;font-family:var(--font-h);font-size:13px;
      cursor:${disabled ? 'not-allowed' : 'pointer'};border:2px solid #c090f0;
      background:${disabled ? '#f4eeff' : bg};color:${disabled ? '#b0a0c8' : color};
      opacity:${disabled ? 0.6 : 1};">
      ${label}${num != null ? ` (장면 ${num})` : ''}
    </button>`;
  };

  tabsEl.innerHTML = `
    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;width:100%;">
      <span style="font-size:11px;color:#9b4dca;font-family:var(--font-h);">시작 기준</span>
      ${modeBtn('entry',  '🟢 처음 시작', entryNum)}
      ${modeBtn('replay', '🔁 다시 할 때', replayNum)}
      <span style="flex:1;"></span>
      <span style="font-size:11px;color:var(--muted);">엔딩별 이야기 흐름 점검</span>
    </div>`;

  /* 본문 — 시작점 유효성 */
  if (curStart == null) {
    contentEl.innerHTML = `<div style="color:var(--muted);text-align:center;padding:24px;">
      ${_routeMode === 'entry' ? '처음 시작 장면' : '다시 할 때 시작 장면'}이 지정되지 않았어요.<br>
      <span style="font-size:11px;">[⚙ 시작점]에서 설정하거나 장면을 먼저 만들어 주세요.</span>
    </div>`;
    return;
  }

  /* 경로 생성 + 그룹화 */
  const routes = findAllRoutes(curStart);

  if (!routes.length) {
    contentEl.innerHTML = `<div style="color:var(--muted);text-align:center;padding:24px;">
      장면 ${curStart}에서 시작하는 연결된 경로가 없어요.
    </div>`;
    return;
  }

  const groups = _rtGroupByEnding(routes);

  /* 요약 통계 */
  const totalRoutes    = routes.length;
  const endingGroups   = groups.filter(g => g.kind === 'ending' || g.kind === 'true-ending');
  const issueGroups    = groups.filter(g => g.kind.startsWith('issue-'));
  const capReachedGlobal = totalRoutes >= ROUTE_MAX_PATHS;

  let html = `<div style="background:#f8f0ff;border-radius:12px;padding:10px 14px;margin-bottom:14px;
    display:flex;align-items:center;gap:12px;flex-wrap:wrap;font-size:12px;color:#7030b0;">
    <b>장면 ${curStart}</b>에서 시작 ·
    엔딩 <b>${endingGroups.length}</b>개 ·
    경로 <b>${totalRoutes}</b>개
    ${issueGroups.length ? ` · <span style="color:#c05000;">이슈 ${issueGroups.length}종</span>` : ''}
    ${capReachedGlobal ? `<span style="color:#c00;">⚠️ 경로가 너무 많아 일부만 계산됨</span>` : ''}
  </div>`;

  groups.forEach(g => {
    const shown    = g.routes.slice(0, ROUTES_PER_ENDING_CAP);
    const overflow = g.routes.length - shown.length;

    let headerColor, headerBg, headerBorder, icon;
    if (g.kind === 'true-ending')        { headerColor = '#b08000'; headerBg = '#fffbe6'; headerBorder = '#f0c000'; icon = '⭐'; }
    else if (g.kind === 'ending')        { headerColor = '#7030b0'; headerBg = '#f8f0ff'; headerBorder = '#c090f0'; icon = '🏁'; }
    else                                 { headerColor = '#8a5000'; headerBg = '#fff8e8'; headerBorder = '#f0a060'; icon = g.icon || '⚠️'; }

    const endingNumHtml = (g.endingNum != null) ? ` · 장면 ${g.endingNum}` : '';

    html += `<details class="rt-group" open
      style="border:1.5px solid ${headerBorder};border-radius:12px;margin-bottom:12px;background:#fff;">
      <summary style="padding:10px 14px;cursor:pointer;list-style:none;display:flex;align-items:center;gap:8px;
        background:${headerBg};border-radius:10px 10px 0 0;font-family:var(--font-h);">
        <span style="font-size:15px;">${icon}</span>
        <span style="color:${headerColor};font-size:14px;">${_rtEsc(g.title)}${endingNumHtml}</span>
        <span style="margin-left:auto;font-size:11px;color:${headerColor};background:#fff;padding:2px 8px;border-radius:50px;border:1px solid ${headerBorder};">
          경로 ${g.routes.length}개
        </span>
      </summary>
      <div style="padding:8px 14px 12px;">
        ${shown.map((p, i) => _rtPathHtml(p, i)).join('')}
        ${overflow > 0 ? `<div style="margin-top:6px;padding:8px 12px;background:#fff8e8;border-radius:8px;font-size:12px;color:#8a5000;">경로가 많아 ${ROUTES_PER_ENDING_CAP}개까지만 표시했어요. (남은 ${overflow}개)</div>` : ''}
      </div>
    </details>`;
  });

  contentEl.innerHTML = html;
}

/* ── 장면 카드로 점프 ──
   v134: 환경 분기 — viewer-edit(다듬기)에서 열린 경우 editNavigateTo로 다듬기 패널 진입.
   v136: 진단 로그 추가 — 어디서 막히는지 콘솔에서 확인 가능.
         + viewer-edit 환경으로 보이는데 editNavigateTo가 없으면 fallback으로
         ViewerState.currentSceneId + renderCurrentScene 직접 호출. */
function _rtJumpToCard(num) {
  const _hasViewer = typeof window !== 'undefined' && typeof window.ViewerState !== 'undefined';
  const _hasEditNav = typeof window !== 'undefined' && typeof window.editNavigateTo === 'function';
  const _hasRender = typeof window !== 'undefined' && typeof window.renderCurrentScene === 'function';
  const _sceneOK = _hasViewer && window.ViewerState && window.ViewerState.scenes &&
                   window.ViewerState.scenes[String(num)];

  /* v136 진단 로그 — 사용자가 콘솔에서 확인할 수 있게 */
  try {
    console.log('[rt jump v136]', {
      num,
      hasViewer: _hasViewer,
      hasEditNav: _hasEditNav,
      hasRender: _hasRender,
      sceneOK: !!_sceneOK,
      sceneKeys: _hasViewer && window.ViewerState && window.ViewerState.scenes
        ? Object.keys(window.ViewerState.scenes).slice(0, 5) : null,
      editMode: _hasViewer && window.ViewerState ? window.ViewerState.editMode : null,
    });
  } catch (e) { /* noop */ }

  /* viewer-edit 환경 — editNavigateTo가 있고 sceneId가 유효하면 그대로 호출 */
  if (_hasEditNav && _sceneOK) {
    closeRoutePanel();
    requestAnimationFrame(() => {
      try {
        window.editNavigateTo(String(num));
        console.log('[rt jump v136] editNavigateTo 완료');
      } catch (e) {
        console.error('[rt jump v136] editNavigateTo 실패:', e);
      }
    });
    return;
  }

  /* v136 fallback: viewer 환경인데 editNavigateTo가 없는 경우
     — ViewerState.currentSceneId + renderCurrentScene 직접 호출 */
  if (_hasViewer && _sceneOK && _hasRender) {
    closeRoutePanel();
    requestAnimationFrame(() => {
      try {
        if (window.ViewerState.stopAudio) window.ViewerState.stopAudio();
        window.ViewerState.currentSceneId = String(num);
        window.ViewerState.selectedChoiceId = null;
        if (Array.isArray(window.ViewerState.historyStack) && window.ViewerState.historyStack.length === 0) {
          window.ViewerState.historyStack = ['__edit_entry__'];
        }
        window.renderCurrentScene();
        console.log('[rt jump v136] fallback renderCurrentScene 완료');
      } catch (e) {
        console.error('[rt jump v136] fallback 실패:', e);
      }
    });
    return;
  }

  /* maker 환경 — 기존 카드 스크롤 + 하이라이트 흐름 */
  closeRoutePanel();
  requestAnimationFrame(() => {
    const card = document.getElementById('card-' + num);
    if (!card) {
      console.warn('[rt jump v136] maker path: card-' + num + ' 박지 X');
      return;
    }
    card.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    card.classList.add('rt-highlight');
    setTimeout(() => card.classList.remove('rt-highlight'), 1400);
  });
}

/* ── 이벤트 위임 — DOM 요소 자체는 유지되므로 1회 등록만 ──
   PERF-2B-1: storyAnalyzer.js 지연 로드 대응 — DOMContentLoaded 이후 로드돼도 즉시 바인딩되도록 readyState 가드.
   (#route-tabs/#route-content는 viewer.html 정적 요소라 늦은 실행에도 존재.) */
function _rtBindRouteEvents() {
  const tabs    = document.getElementById('route-tabs');
  const content = document.getElementById('route-content');

  /* 시작 기준 토글 */
  if (tabs) {
    tabs.addEventListener('click', e => {
      const btn = e.target.closest('.js-rt-mode');
      if (!btn || btn.disabled) return;
      const mode = btn.dataset.mode;
      if (mode && mode !== _routeMode) {
        _routeMode = mode;
        renderRoutePanel();
      }
    });
  }

  /* 장면 줄 → 카드 점프 + v130 인라인 편집 */
  if (content) {
    content.addEventListener('click', e => {
      /* v130: ✎ 본문 수정 — scene 카드 점프보다 우선 처리 */
      const editBodyBtn = e.target.closest('.js-rt-edit-body');
      if (editBodyBtn) {
        e.stopPropagation();
        const line = editBodyBtn.closest('.js-rt-scene');
        if (line) _rtEnterEditBody(line);
        return;
      }
      /* v130: ✎ 선택지 라벨 수정 */
      const editChoiceBtn = e.target.closest('.js-rt-edit-choice');
      if (editChoiceBtn) {
        e.stopPropagation();
        const cl = editChoiceBtn.closest('.rt-choice-line');
        if (cl) _rtEnterEditChoice(cl);
        return;
      }
      /* v130: 본문 인라인 저장 / 취소 */
      const saveBodyBtn = e.target.closest('.js-rt-save-body');
      if (saveBodyBtn) {
        const line = saveBodyBtn.closest('.js-rt-scene');
        if (line) _rtFinishEditBody(line, true);
        return;
      }
      const cancelBodyBtn = e.target.closest('.js-rt-cancel-body');
      if (cancelBodyBtn) {
        const line = cancelBodyBtn.closest('.js-rt-scene');
        if (line) _rtFinishEditBody(line, false);
        return;
      }
      /* v130: 선택지 인라인 저장 / 취소 */
      const saveChoiceBtn = e.target.closest('.js-rt-save-choice');
      if (saveChoiceBtn) {
        const cl = saveChoiceBtn.closest('.rt-choice-line');
        if (cl) _rtFinishEditChoice(cl, true);
        return;
      }
      const cancelChoiceBtn = e.target.closest('.js-rt-cancel-choice');
      if (cancelChoiceBtn) {
        const cl = cancelChoiceBtn.closest('.rt-choice-line');
        if (cl) _rtFinishEditChoice(cl, false);
        return;
      }
      /* 인라인 editor 안 클릭은 무시 (textarea/input 자체) */
      if (e.target.closest('.rt-inline-editor-wrap')) return;
      /* v135-fix: scene 카드 전체 클릭 영역으로 확장 — 옛엔 .rt-scene-text만 반응해
         사용자가 prefix/여백 영역을 클릭하면 동작하지 않았음.
         이제 .js-rt-scene 카드 전체 영역 어디를 클릭해도 점프.
         (✎ 버튼은 위쪽 핸들러에서 stopPropagation 처리돼 충돌 X) */
      const line = e.target.closest('.js-rt-scene');
      if (line) {
        const n = Number(line.dataset.num);
        if (Number.isFinite(n)) _rtJumpToCard(n);
      }
    });

    /* v130: 키보드 단축키 — textarea Ctrl/Cmd+Enter 저장, Esc 취소 / input Enter 저장, Esc 취소 */
    content.addEventListener('keydown', e => {
      if (e.isComposing || e.keyCode === 229) return; /* CROSS-A: 한글 IME 조합 중 Enter 가드 */
      const ta = e.target.closest('.rt-inline-body-editor');
      if (ta) {
        if (e.key === 'Escape') {
          e.preventDefault();
          const line = ta.closest('.js-rt-scene');
          if (line) _rtFinishEditBody(line, false);
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          const line = ta.closest('.js-rt-scene');
          if (line) _rtFinishEditBody(line, true);
        }
        return;
      }
      const input = e.target.closest('.rt-inline-choice-editor');
      if (input) {
        if (e.key === 'Escape') {
          e.preventDefault();
          const cl = input.closest('.rt-choice-line');
          if (cl) _rtFinishEditChoice(cl, false);
        } else if (e.key === 'Enter') {
          e.preventDefault();
          const cl = input.closest('.rt-choice-line');
          if (cl) _rtFinishEditChoice(cl, true);
        }
      }
    });
  }
}
if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', _rtBindRouteEvents);
else _rtBindRouteEvents();
