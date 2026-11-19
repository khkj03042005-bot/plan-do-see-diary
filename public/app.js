'use strict';
(function () {
  const app = document.getElementById('app');
  const PRI = { high: '높음', medium: '보통', low: '낮음' };
  const STAT = { todo: '할 일', doing: '진행 중', done: '완료' };
  const METRICS = [['plans', '계획'], ['tasks', '할 일'], ['done', '완료'], ['overdue', '지연'], ['blocked', '막힘'], ['estimated_minutes', '예상 시간(분)'], ['actual_minutes', '실제 시간(분)'], ['diff_minutes', '차이(분)']];

  // ---------- helpers (사용자 입력은 항상 textContent 로만 렌더링 → 스크립트 문자열도 그대로 보임) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return el;
  }
  const show = (...kids) => app.replaceChildren(...kids.flat(Infinity).filter((k) => k != null && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
  async function api(method, url, body) {
    const res = await fetch(url, { method, headers: { 'X-Requested-With': 'diary', ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { location.href = '/login'; throw new Error('로그인이 필요합니다.'); }
    if (!res.ok) throw new Error(data.error || `요청 실패 (${res.status})`);
    return data;
  }
  function toast(msg, err) { const t = h('div', { class: 'toast' + (err ? ' err' : ''), role: 'status' }, msg); document.body.append(t); setTimeout(() => t.remove(), 3200); }
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message, true); } };
  const kstNow = () => new Date(Date.now() + 9 * 3600e3);
  const todayKst = () => kstNow().toISOString().slice(0, 10);
  const fmtKst = (iso) => (iso ? new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') + ' KST' : '-');
  const kstInputNow = () => kstNow().toISOString().slice(0, 16);
  const inputToIso = (v) => (v ? new Date(v + ':00+09:00').toISOString() : '');
  const isoToInput = (iso) => new Date(Date.parse(iso) + 9 * 3600e3).toISOString().slice(0, 16);
  const mins = (n) => `${n}분`;
  const qs = (o) => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'k-' + Date.now() + '-' + Math.random().toString(16).slice(2));
  function field(label, input, cls) { return h('label', { class: cls }, label, input); }
  const sel = (name, opts, val, attrs) => h('select', { name, ...attrs }, opts.map(([v, t]) => h('option', { value: v, selected: String(v) === String(val) }, t)));
  const priOpts = Object.entries(PRI);
  const formData = (f) => Object.fromEntries(new FormData(f).entries());
  function hashQuery() { const i = location.hash.indexOf('?'); return Object.fromEntries(new URLSearchParams(i < 0 ? '' : location.hash.slice(i + 1))); }
  const routeName = () => (location.hash.replace(/^#\//, '').split('?')[0] || 'plans');
  const planLabel = (p) => `#${p.id} ${p.title}`;

  // ---------- 계획 ----------
  async function viewPlans() {
    const plans = await api('GET', '/api/plans');
    const q = hashQuery(); const editing = q.edit ? plans.find((p) => String(p.id) === q.edit) : null;
    const v = editing || { title: '', period_start: todayKst(), period_end: '', priority: 'medium', success_criteria: '', estimated_minutes: '' };
    const form = h('form', { class: 'grid', onsubmit: guard(async (e) => {
      e.preventDefault(); const d = formData(form);
      if (editing) { await api('PUT', `/api/plans/${editing.id}`, d); toast('계획을 수정했습니다. 최초 계획은 이력에 그대로 남아 있습니다.'); location.hash = '#/plans'; }
      else { await api('POST', '/api/plans', d); toast('계획을 저장했습니다.'); form.reset(); render(); }
    }) },
      field('계획 제목 (예: 이번 주 운동)', h('input', { name: 'title', required: true, maxlength: 200, value: v.title }), 'wide'),
      field('시작일 (기간)', h('input', { type: 'date', name: 'period_start', required: true, value: v.period_start })),
      field('종료일 (기간)', h('input', { type: 'date', name: 'period_end', required: true, value: v.period_end })),
      field('우선순위', sel('priority', priOpts, v.priority)),
      field('예상 시간 (분)', h('input', { type: 'number', name: 'estimated_minutes', min: 0, step: 1, required: true, value: v.estimated_minutes })),
      field('성공 기준 (무엇이 되면 성공인가요?)', h('textarea', { name: 'success_criteria', required: true, maxlength: 1000, value: v.success_criteria }), 'wide'),
      h('div', { class: 'row wide' }, h('button', { type: 'submit' }, editing ? '계획 수정 저장' : '계획 저장'), editing && h('a', { class: 'btn ghost', href: '#/plans' }, '취소')));
    show(
      h('h2', {}, editing ? `계획 수정 (#${editing.id})` : '① 계획(Plan) 등록'),
      h('div', { class: 'card' }, form),
      h('h2', {}, `내 계획 (${plans.length})`),
      plans.length ? plans.map(planCard) : h('p', { class: 'muted' }, '아직 계획이 없습니다. 지금 실제로 진행 중인 일 하나를 계획으로 등록해 보세요.'));
  }
  function planCard(p) {
    const rev = p.revisions;
    return h('div', { class: 'card', id: `plan-${p.id}` },
      h('h3', {}, planLabel(p)),
      h('div', {}, `기간 ${p.period_start} ~ ${p.period_end} · 우선순위 ${PRI[p.priority]} · 예상 ${mins(p.estimated_minutes)} · 할 일 ${p.task_count}개`),
      h('div', {}, '성공 기준: ', p.success_criteria),
      p.improvement && h('div', { class: 'tag' }, '반영된 개선점: ', p.improvement.note),
      h('div', { class: 'row' }, h('a', { class: 'btn ghost', href: `#/plans?edit=${p.id}` }, '수정'), h('a', { class: 'btn ghost', href: `#/tasks?plan_id=${p.id}` }, '할 일 보기'), h('a', { class: 'btn ghost', href: `#/retro?plan_id=${p.id}` }, '회고 보기'),
        h('button', { class: 'danger', onclick: guard(async () => { if (confirm('이 계획과 하위 할 일·실행 기록을 삭제할까요?')) { await api('DELETE', `/api/plans/${p.id}`); render(); } }) }, '삭제')),
      h('details', {}, h('summary', {}, `수정 이력 (${rev.length}건 · 최초 계획 포함)`),
        h('table', {}, h('thead', {}, h('tr', {}, ['구분', '시각', '제목', '기간', '우선순위', '성공 기준', '예상'].map((t) => h('th', {}, t)))),
          h('tbody', {}, rev.map((r) => h('tr', {}, h('td', {}, r.revision_no === 0 ? '최초 계획' : `수정 ${r.revision_no}`), h('td', {}, fmtKst(r.revised_at)), h('td', {}, r.title), h('td', {}, `${r.period_start}~${r.period_end}`), h('td', {}, PRI[r.priority]), h('td', {}, r.success_criteria), h('td', {}, mins(r.estimated_minutes))))))));
  }

  // ---------- 할 일 ----------
  const completeKeys = new Map();
  async function viewTasks() {
    const plans = await api('GET', '/api/plans');
    const q = hashQuery(); const sortDefault = { sort: 'due_date', dir: 'asc' };
    const f = { q: '', status: '', priority: '', tag: '', plan_id: '', overdue: '', ...sortDefault, ...q };
    const res = await api('GET', '/api/tasks?' + qs(f));
    const KEYS = [['due_date', '마감일'], ['priority', '우선순위'], ['estimated_minutes', '예상 시간'], ['created_at', '등록 시각'], ['title', '제목']];
    const keyName = Object.fromEntries(KEYS);
    const filt = h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); const d = formData(filt); location.hash = '#/tasks?' + qs(d); } },
      field('검색 (제목·태그)', h('input', { name: 'q', value: f.q })),
      field('계획', sel('plan_id', [['', '전체'], ...plans.map((p) => [p.id, planLabel(p)])], f.plan_id)),
      field('상태', sel('status', [['', '전체'], ...Object.entries(STAT)], f.status)),
      field('우선순위', sel('priority', [['', '전체'], ...priOpts], f.priority)),
      field('태그', h('input', { name: 'tag', value: f.tag })),
      field('지연만', sel('overdue', [['', '전체'], ['1', '지연된 것만']], f.overdue)),
      field('정렬 기준', sel('sort', KEYS, res.sort)),
      field('정렬 방향', sel('dir', [['asc', '오름차순'], ['desc', '내림차순']], res.dir)),
      h('button', { type: 'submit' }, '적용'), h('a', { class: 'btn ghost', href: '#/tasks' }, '초기화'));
    const create = h('form', { class: 'grid', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/tasks', formData(create)); toast('할 일을 저장했습니다.'); create.reset(); render(); }) },
      field('계획', sel('plan_id', plans.map((p) => [p.id, planLabel(p)]), f.plan_id || (plans[0] && plans[0].id), { required: true })),
      field('할 일', h('input', { name: 'title', required: true, maxlength: 200 })),
      field('마감일', h('input', { type: 'date', name: 'due_date' })),
      field('우선순위', sel('priority', priOpts, 'medium')),
      field('예상 시간 (분)', h('input', { type: 'number', name: 'estimated_minutes', min: 0, step: 1, required: true })),
      field('태그 (쉼표로 구분)', h('input', { name: 'tags' })),
      h('button', { type: 'submit' }, '할 일 저장'));
    show(
      h('h2', {}, '② 할 일(Do) 만들기'),
      plans.length ? h('div', { class: 'card' }, create) : h('p', { class: 'notice' }, '먼저 ① 계획을 등록하세요.'),
      h('h2', {}, '검색 · 필터링 · 정렬'), h('div', { class: 'card' }, filt),
      h('div', { class: 'sortinfo', id: 'sort-info' }, `정렬 기준: ${keyName[res.sort]} ${res.dir === 'asc' ? '오름차순' : '내림차순'} · 값이 같으면 ID 오름차순(tie-breaker) · 필터·검색·정렬은 서버(DB)에서 처리 · 결과 ${res.tasks.length}건`),
      h('div', { class: 'card' }, res.tasks.length ? res.tasks.map(taskRow) : h('p', { class: 'muted' }, '조건에 맞는 할 일이 없습니다.')));
  }
  function taskRow(t) {
    const done = t.status === 'done';
    const box = h('div', { class: 'item', id: `task-${t.id}` });
    const view = () => box.replaceChildren(
      h('div', {}, h('b', {}, `#${t.id} ${t.title}`), ' ', h('span', { class: 'pill' + (done ? ' done' : '') }, STAT[t.status]), ' ', t.overdue && h('span', { class: 'pill late' }, '지연')),
      h('div', { class: 'muted' }, `계획 ${t.plan_id} ${t.plan_title} · 마감 ${t.due_date || '-'} · 우선순위 ${PRI[t.priority]} · 예상 ${mins(t.estimated_minutes)} · 실제 ${mins(t.actual_minutes)} (실행 기록 ${t.run_count}건)`, done ? ` · 완료 ${fmtKst(t.completed_at)}` : ''),
      h('div', {}, t.tags.map((g) => h('span', { class: 'tag' }, '#' + g))),
      h('div', { class: 'row' },
        done
          ? h('button', { class: 'ghost', onclick: guard(async () => { await api('PUT', `/api/tasks/${t.id}`, { ...t, tags: t.tags, status: 'doing' }); render(); }) }, '완료 취소 (진행 중으로)')
          : [t.status === 'todo' && h('button', { class: 'ghost', onclick: guard(async () => { await api('PUT', `/api/tasks/${t.id}`, { ...t, status: 'doing' }); render(); }) }, '진행 시작'),
             h('button', { class: 'complete-btn', onclick: guard(async (e) => {
               // 같은 의도의 클릭은 같은 멱등성 키 → 연속 클릭해도 서버/DB 에서 1건만 저장
               if (!completeKeys.has(t.id)) completeKeys.set(t.id, uuid());
               const btn = e.currentTarget; btn.disabled = true;
               try { const r = await api('POST', `/api/tasks/${t.id}/complete`, { idempotency_key: completeKeys.get(t.id) }); toast(r.duplicate ? '이미 완료된 할 일입니다 (중복 저장 없음).' : '완료 처리했습니다.'); }
               finally { completeKeys.delete(t.id); }
               render();
             }) }, '완료')],
        h('button', { class: 'ghost', onclick: () => edit() }, '수정'), h('a', { class: 'btn ghost', href: `#/runs?task_id=${t.id}` }, '실행 기록'),
        h('button', { class: 'danger', onclick: guard(async () => { if (confirm('이 할 일을 삭제할까요?')) { await api('DELETE', `/api/tasks/${t.id}`); render(); } }) }, '삭제')));
    const edit = () => {
      const f = h('form', { class: 'grid', onsubmit: guard(async (e) => { e.preventDefault(); await api('PUT', `/api/tasks/${t.id}`, { ...formData(f), status: t.status }); toast('수정했습니다.'); render(); }) },
        field('할 일', h('input', { name: 'title', required: true, value: t.title })), field('마감일', h('input', { type: 'date', name: 'due_date', value: t.due_date || '' })),
        field('우선순위', sel('priority', priOpts, t.priority)), field('예상 시간 (분)', h('input', { type: 'number', name: 'estimated_minutes', min: 0, required: true, value: t.estimated_minutes })),
        field('태그', h('input', { name: 'tags', value: t.tags.join(', ') })),
        h('div', { class: 'row' }, h('button', { type: 'submit' }, '저장'), h('button', { type: 'button', class: 'ghost', onclick: view }, '취소')));
      box.replaceChildren(f);
    };
    view(); return box;
  }

  // ---------- 실행 기록 ----------
  async function viewRuns() {
    const q = hashQuery();
    const [tasksRes, runs] = await Promise.all([api('GET', '/api/tasks?sort=created_at&dir=desc'), api('GET', '/api/runs?' + qs({ task_id: q.task_id }))]);
    const tasks = tasksRes.tasks;
    const f = h('form', { class: 'grid', onsubmit: guard(async (e) => {
      e.preventDefault(); const d = formData(f);
      await api('POST', '/api/runs', { task_id: d.task_id, started_at: inputToIso(d.started_at), ended_at: inputToIso(d.ended_at), actual_minutes: d.actual_minutes, blocked_reason: d.blocked_reason });
      toast('실행 기록을 저장했습니다. 계획·할 일 값은 바뀌지 않습니다.'); render();
    }) },
      field('어느 할 일의 실행인가요?', sel('task_id', tasks.map((t) => [t.id, `#${t.id} ${t.title} (계획 ${t.plan_id})`]), q.task_id || (tasks[0] && tasks[0].id), { required: true }), 'wide'),
      field('시작 시각 (KST)', h('input', { type: 'datetime-local', name: 'started_at', required: true, value: kstInputNow() })),
      field('종료 시각 (KST)', h('input', { type: 'datetime-local', name: 'ended_at', required: true, value: kstInputNow() })),
      field('실제 소요 시간 (분, 비우면 시작~종료로 계산)', h('input', { type: 'number', name: 'actual_minutes', min: 0, step: 1 })),
      field('막힘 사유 (없으면 비움)', h('input', { name: 'blocked_reason', maxlength: 500 })),
      h('button', { type: 'submit' }, '실행 기록 저장'));
    show(
      h('h2', {}, '③ 실행 기록(Do)'),
      tasks.length ? h('div', { class: 'card' }, f) : h('p', { class: 'notice' }, '먼저 ② 할 일을 만드세요.'),
      h('h2', {}, `실행 기록 ${runs.length}건` + (q.task_id ? ` (할 일 #${q.task_id}만)` : '')), q.task_id && h('a', { href: '#/runs' }, '전체 보기'),
      h('div', { class: 'card' }, runs.length ? runs.map((r) => h('div', { class: 'item', id: `run-${r.id}` },
        h('div', {}, h('b', {}, `실행 #${r.id}`), ' → 할 일 ', h('a', { href: `#/tasks?plan_id=${r.plan_id}` }, `#${r.task_id} ${r.task_title}`), ` (계획 #${r.plan_id} ${r.plan_title})`),
        h('div', { class: 'muted' }, `${fmtKst(r.started_at)} ~ ${fmtKst(r.ended_at)} · 실제 ${mins(r.actual_minutes)}`),
        r.blocked_reason && h('div', {}, '막힘 사유: ', r.blocked_reason),
        h('button', { class: 'danger', onclick: guard(async () => { await api('DELETE', `/api/runs/${r.id}`); render(); }) }, '삭제'))) : h('p', { class: 'muted' }, '실행 기록이 없습니다.')));
  }

  // ---------- 회고 ----------
  async function viewRetro() {
    const q = hashQuery(); const plans = await api('GET', '/api/plans');
    const scope = { plan_id: q.plan_id || '', from: q.from || '', to: q.to || '' };
    const r = await api('GET', '/api/retro?' + qs(scope));
    const filt = h('form', { class: 'toolbar', onsubmit: (e) => { e.preventDefault(); location.hash = '#/retro?' + qs(formData(filt)); } },
      field('계획', sel('plan_id', [['', '전체'], ...plans.map((p) => [p.id, planLabel(p)])], scope.plan_id)),
      field('기간 시작 이후', h('input', { type: 'date', name: 'from', value: scope.from })), field('기간 종료 이전', h('input', { type: 'date', name: 'to', value: scope.to })),
      h('button', { type: 'submit' }, '집계'), h('a', { class: 'btn ghost', href: '#/retro' }, '초기화'));
    const link = (m, p) => `#/evidence?${qs({ metric: m, plan_id: p || scope.plan_id, from: scope.from, to: scope.to })}`;
    const tile = (m, label, val, p) => h('a', { class: 'tile', href: link(m, p), title: '클릭하면 이 값의 근거 기록으로 이동합니다' }, h('b', {}, val), h('span', {}, label + ' · 근거 보기'));
    const tiles = h('div', { class: 'tiles' }, METRICS.map(([m, label]) => tile(m, label, r.summary[m])));
    const allZero = METRICS.every(([m]) => r.summary[m] === 0);
    show(
      h('h2', {}, '④ 회고(See): 예상 대비 실제'),
      h('div', { class: 'card' }, filt),
      h('div', { class: 'card' }, h('h3', {}, `집계 (기준일 ${r.today} KST, 단위 분)`), allZero ? h('p', { class: 'muted' }, '집계할 데이터가 없습니다. 계획·할 일·실행 기록을 먼저 입력하세요.') : null, tiles,
        h('p', { class: 'muted' }, '숫자를 누르면 해당 값을 만든 계획·할 일·실행 기록으로 이동합니다. 차이 = 실제 − 예상 (대상 데이터가 없으면 0).')),
      h('h2', {}, '계획별 회고'),
      r.per_plan.map((pp) => planRetro(pp, plans, link)),
      !r.per_plan.length && h('p', { class: 'muted' }, '해당하는 계획이 없습니다.'));
  }
  function planRetro(pp, plans, link) {
    const p = pp.plan; const m = pp.metrics;
    const noteForm = h('form', { class: 'row', onsubmit: guard(async (e) => { e.preventDefault(); await api('POST', '/api/retro/notes', { plan_id: p.id, note: noteForm.note.value }); toast('개선점을 저장했습니다.'); render(); }) },
      h('input', { name: 'note', required: true, maxlength: 500, placeholder: '다음 계획에 반영할 개선점 한 줄', size: 40 }), h('button', { type: 'submit' }, '개선점 저장'));
    return h('div', { class: 'card', id: `retro-${p.id}` }, h('h3', {}, planLabel(p), ` (${p.period_start} ~ ${p.period_end})`),
      h('div', { class: 'tiles' }, METRICS.map(([k, label]) => h('a', { class: 'tile', href: link(k, p.id) }, h('b', {}, m[k]), h('span', {}, label)))),
      h('p', {}, `예상 ${mins(m.estimated_minutes)} 대비 실제 ${mins(m.actual_minutes)} → 차이 ${m.diff_minutes > 0 ? '+' : ''}${m.diff_minutes}분 · 완료율 ${m.tasks ? Math.round((m.done / m.tasks) * 100) : 0}%`),
      h('h3', {}, '개선점 (다음 계획에 반영)'), noteForm,
      pp.notes.map((n) => {
        const targets = plans.filter((x) => x.id !== p.id);
        const pick = sel('plan_id', [['', '새 계획 만들어 반영'], ...targets.map((x) => [x.id, `기존 ${planLabel(x)}에 반영`])], '');
        return h('div', { class: 'item' }, h('div', {}, '“', n.note, '”'),
          n.applied_plan_id ? h('div', { class: 'tag' }, `다음 계획 #${n.applied_plan_id}에 반영됨`) : h('div', { class: 'row' }, pick, h('button', { class: 'ghost', onclick: guard(async () => { const r = await api('POST', `/api/retro/notes/${n.id}/apply`, { plan_id: pick.value }); toast(`계획 #${r.plan.id}에 반영했습니다.`); render(); }) }, '다음 계획에 반영')));
      }));
  }
  async function viewEvidence() {
    const q = hashQuery(); const ev = await api('GET', '/api/retro/evidence?' + qs(q));
    const back = '#/retro?' + qs({ plan_id: q.plan_id, from: q.from, to: q.to });
    show(h('a', { href: back }, '← 회고로 돌아가기'), h('h2', {}, `근거 기록: ${ev.label}`), h('p', { class: 'notice' }, '산출 규칙: ', ev.rule),
      ev.plans.length > 0 && h('div', { class: 'card' }, h('h3', {}, `계획 ${ev.plans.length}건`), ev.plans.map((p) => h('div', { class: 'item' }, planLabel(p), ` · ${p.period_start}~${p.period_end} · 예상 ${mins(p.estimated_minutes)}`))),
      h('div', { class: 'card' }, h('h3', {}, `할 일 ${ev.tasks.length}건`), ev.tasks.length ? ev.tasks.map((t) => h('div', { class: 'item', id: `ev-task-${t.id}` }, `#${t.id} ${t.title} · ${STAT[t.status]}${t.overdue ? ' · 지연' : ''} · 마감 ${t.due_date || '-'} · 예상 ${mins(t.estimated_minutes)} · 실제 ${mins(t.actual_minutes)}`)) : h('p', { class: 'muted' }, '해당 기록 없음')),
      ['actual_minutes', 'blocked', 'diff_minutes'].includes(ev.metric) && h('div', { class: 'card' }, h('h3', {}, `실행 기록 ${ev.runs.length}건`), ev.runs.length ? ev.runs.map((r) => h('div', { class: 'item', id: `ev-run-${r.id}` }, `실행 #${r.id} → 할 일 #${r.task_id} ${r.task_title} · ${fmtKst(r.started_at)} ~ ${fmtKst(r.ended_at)} · ${mins(r.actual_minutes)}`, r.blocked_reason ? ` · 막힘: ${r.blocked_reason}` : '')) : h('p', { class: 'muted' }, '해당 기록 없음')));
  }

  // ---------- 내보내기 ----------
  async function viewExport() {
    const data = await api('GET', '/api/export');
    const counts = { 계획: data.plans.length, 수정이력: data.plan_revisions.length, 할일: data.tasks.length, 실행기록: data.runs.length, 완료기록: data.completions.length, 개선점: data.retro_notes.length };
    show(h('h2', {}, '내보내기'), h('div', { class: 'card' },
      h('p', {}, '내 데이터 전체(계획·수정 이력·할 일·실행 기록·완료 기록·회고)를 파일 하나(JSON)로 내려받습니다.'),
      h('p', { class: 'muted' }, Object.entries(counts).map(([k, v]) => `${k} ${v}건`).join(' · ')),
      h('a', { class: 'btn', id: 'export-link', href: '/api/export', download: 'pds-diary-export.json' }, '데이터 파일 1개 내려받기'),
      h('p', { class: 'muted' }, '스키마: '), h('a', { href: '/contracts/pds-schema-v2.json' }, 'contracts/pds-schema-v2.json')));
  }

  // ---------- 계정 ----------
  async function viewAccount() {
    const me = await api('GET', '/api/me');
    const pw = h('form', { class: 'grid', onsubmit: guard(async (e) => {
      e.preventDefault(); const d = formData(pw);
      const r = await api('POST', '/api/password', { old_password: d.old_password, new_password: d.new_password });
      alert(r.message); location.href = '/login';
    }) }, field('현재 비밀번호', h('input', { name: 'old_password', type: 'password', autocomplete: 'current-password', required: true })),
      field('새 비밀번호 (8자 이상)', h('input', { name: 'new_password', type: 'password', autocomplete: 'new-password', required: true, minlength: 8 })),
      h('button', { type: 'submit' }, '비밀번호 변경'));
    const del = h('form', { class: 'grid', onsubmit: guard(async (e) => {
      e.preventDefault();
      if (!confirm('계정과 모든 기록(계획·할 일·실행 기록·완료 기록·회고)이 영구 삭제됩니다. 계속할까요?')) return;
      const r = await api('POST', '/api/account/delete', { password: formData(del).password });
      alert(r.message); location.href = '/login';
    }) }, field('비밀번호 확인', h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true })),
      h('button', { class: 'danger', type: 'submit' }, '계정 삭제'));
    show(h('h2', {}, '계정'),
      h('div', { class: 'card' }, h('p', {}, `로그인: ${me.username}`), h('p', { class: 'muted' }, `이 세션은 ${fmtKst(me.session_expires_at)} 에 만료됩니다. 로그아웃하면 서버에서 즉시 무효화됩니다.`),
        h('button', { class: 'ghost', id: 'logout', onclick: guard(logout) }, '로그아웃')),
      h('div', { class: 'card' }, h('h3', {}, '비밀번호 변경'), pw, h('p', { class: 'muted' }, '변경하면 이전에 발급된 모든 세션이 무효화되어 다시 로그인해야 합니다.')),
      h('div', { class: 'card' }, h('h3', {}, '계정 삭제'), h('p', { class: 'notice' }, '계정을 삭제하면 내 계정과 모든 기록(계획·수정 이력·할 일·실행 기록·완료 기록·회고)이 함께 영구 삭제됩니다.'), del));
  }
  async function logout() { await api('POST', '/api/logout'); location.href = '/login'; }

  // ---------- router ----------
  const views = { plans: viewPlans, tasks: viewTasks, runs: viewRuns, retro: viewRetro, evidence: viewEvidence, export: viewExport, account: viewAccount };
  let seq = 0;
  async function render() {
    const name = views[routeName()] ? routeName() : 'plans'; const my = ++seq;
    document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.r === (name === 'evidence' ? 'retro' : name)));
    try { await views[name](); } catch (e) { if (my === seq) show(h('p', { class: 'notice' }, '불러오지 못했습니다: ' + e.message)); }
  }
  window.addEventListener('hashchange', render);
  (async () => {
    const who = document.getElementById('whoami');
    try {
      const me = await api('GET', '/api/me');
      who.replaceChildren(`로그인: ${me.username} `, h('button', { class: 'ghost', id: 'top-logout', onclick: guard(logout) }, '로그아웃'));
    } catch (e) { return; }
    render();
  })();
})();
