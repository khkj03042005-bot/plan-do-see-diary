'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./db');

const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml' };
const PRIORITIES = ['high', 'medium', 'low'];
const STATUSES = ['todo', 'doing', 'done'];
const SORT_SQL = {
  due_date: '(t.due_date IS NULL) ASC, t.due_date {d}',
  priority: "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END {d}",
  estimated_minutes: 't.estimated_minutes {d}',
  created_at: 't.created_at {d}',
  title: 't.title COLLATE NOCASE {d}',
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const nowIso = () => new Date().toISOString();
const kstToday = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

// ---------- validation ----------
function str(v, name, max = 200, required = true) {
  if (v === undefined || v === null || String(v).trim() === '') { if (required) throw bad(`${name}을(를) 입력하세요.`); return ''; }
  const s = String(v).trim();
  if (s.length > max) throw bad(`${name}은(는) ${max}자 이하여야 합니다.`);
  return s;
}
function date(v, name, required = true) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name}을(를) 입력하세요.`); return null; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v + 'T00:00:00Z')) || new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) !== v) throw bad(`${name}은(는) YYYY-MM-DD 형식이어야 합니다.`);
  return v;
}
function isoTime(v, name) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) || isNaN(Date.parse(v))) throw bad(`${name}은(는) 올바른 시각이어야 합니다.`);
  return new Date(v).toISOString();
}
function minutes(v, name, required = true) {
  if (v === undefined || v === null || v === '') { if (required) throw bad(`${name}을(를) 입력하세요.`); return null; }
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100000) throw bad(`${name}은(는) 0 이상의 정수(분)여야 합니다.`);
  return n;
}
function oneOf(v, list, name) { if (!list.includes(v)) throw bad(`${name} 값이 올바르지 않습니다.`); return v; }
function tagList(v) {
  const arr = Array.isArray(v) ? v : String(v || '').split(',');
  const out = [...new Set(arr.map((t) => String(t).trim().replace(/^#/, '')).filter(Boolean))];
  if (out.length > 10) throw bad('태그는 10개 이하여야 합니다.');
  out.forEach((t) => { if (t.length > 30) throw bad('태그는 30자 이하여야 합니다.'); });
  return out;
}
function planFields(b) {
  const f = {
    title: str(b.title, '계획 제목'),
    period_start: date(b.period_start, '시작일'),
    period_end: date(b.period_end, '종료일'),
    priority: oneOf(b.priority, PRIORITIES, '우선순위'),
    success_criteria: str(b.success_criteria, '성공 기준', 1000),
    estimated_minutes: minutes(b.estimated_minutes, '예상 시간'),
  };
  if (f.period_end < f.period_start) throw bad('종료일은 시작일보다 빠를 수 없습니다.');
  return f;
}

function createApp({ dbPath = process.env.DB_PATH || path.join(__dirname, 'data', 'pds.db'), today = kstToday } = {}) {
  const db = openDb(dbPath);
  let depth = 0;
  const tx = (fn) => { // 중첩 호출은 바깥 트랜잭션에 합류
    if (depth > 0) return fn();
    db.exec('BEGIN IMMEDIATE'); depth++;
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } finally { depth--; }
  };
  const get = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const plain = (r) => (r ? { ...r } : r);
  const plainAll = (rows) => rows.map((r) => ({ ...r }));

  // ---------- plans ----------
  const getPlan = (id) => { const p = get('SELECT * FROM plans WHERE id = ?', id); if (!p) throw new HttpError(404, '계획을 찾을 수 없습니다.'); return plain(p); };
  function planDetail(id) {
    const p = getPlan(id);
    p.revisions = plainAll(all('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_no', id));
    p.task_count = get('SELECT COUNT(*) c FROM tasks WHERE plan_id = ?', id).c;
    p.improvement = p.improvement_note_id ? plain(get('SELECT id, note, plan_id AS from_plan_id FROM retro_notes WHERE id = ?', p.improvement_note_id)) : null;
    return p;
  }
  function createPlan(b) {
    const f = planFields(b); const t = nowIso();
    return tx(() => {
      const r = run('INSERT INTO plans (title, period_start, period_end, priority, success_criteria, estimated_minutes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)', f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t, t);
      const id = Number(r.lastInsertRowid);
      run('INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, estimated_minutes, revised_at) VALUES (?,?,?,?,?,?,?,?,?)', id, 0, f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t);
      return planDetail(id);
    });
  }
  function updatePlan(id, b) {
    getPlan(id); const f = planFields(b); const t = nowIso();
    return tx(() => {
      run('UPDATE plans SET title=?, period_start=?, period_end=?, priority=?, success_criteria=?, estimated_minutes=?, updated_at=? WHERE id=?', f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t, id);
      const n = get('SELECT MAX(revision_no) m FROM plan_revisions WHERE plan_id = ?', id).m + 1;
      run('INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, estimated_minutes, revised_at) VALUES (?,?,?,?,?,?,?,?,?)', id, n, f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t);
      return planDetail(id);
    });
  }

  // ---------- tasks ----------
  function taskRows(where = '1=1', params = [], order = 't.id ASC') {
    const rows = all(`SELECT t.*, p.title AS plan_title,
        (SELECT completed_at FROM completions c WHERE c.task_id = t.id) AS completed_at,
        (SELECT COUNT(*) FROM runs r WHERE r.task_id = t.id) AS run_count,
        (SELECT COALESCE(SUM(actual_minutes),0) FROM runs r WHERE r.task_id = t.id) AS actual_minutes
      FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE ${where} ORDER BY ${order}`, ...params);
    const tagStmt = db.prepare('SELECT tag FROM task_tags WHERE task_id = ? ORDER BY tag');
    const td = today();
    return rows.map((r) => ({ ...r, tags: tagStmt.all(r.id).map((x) => x.tag), overdue: r.status !== 'done' && !!r.due_date && r.due_date < td }));
  }
  const getTask = (id) => { const r = taskRows('t.id = ?', [id])[0]; if (!r) throw new HttpError(404, '할 일을 찾을 수 없습니다.'); return r; };
  function listTasks(q) {
    const w = ['1=1']; const p = [];
    if (q.plan_id) { w.push('t.plan_id = ?'); p.push(Number(q.plan_id)); }
    if (q.status) { w.push('t.status = ?'); p.push(oneOf(q.status, STATUSES, '상태')); }
    if (q.priority) { w.push('t.priority = ?'); p.push(oneOf(q.priority, PRIORITIES, '우선순위')); }
    if (q.tag) { w.push('EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = t.id AND g.tag = ?)'); p.push(q.tag); }
    if (q.due_before) { w.push('t.due_date IS NOT NULL AND t.due_date <= ?'); p.push(date(q.due_before, '마감 기준일')); }
    if (q.overdue === '1') { w.push("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ?"); p.push(today()); }
    if (q.q) {
      const like = '%' + String(q.q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      w.push("(t.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = t.id AND g.tag LIKE ? ESCAPE '\\'))"); p.push(like, like);
    }
    const sort = q.sort && SORT_SQL[q.sort] ? q.sort : 'due_date';
    const dir = q.dir === 'desc' ? 'desc' : 'asc';
    // 동률이면 id 오름차순(tie-breaker)
    const order = SORT_SQL[sort].replace('{d}', dir.toUpperCase()) + ', t.id ASC';
    return { sort, dir, tie_breaker: 'id asc', tasks: taskRows(w.join(' AND '), p, order) };
  }
  function taskFields(b, partial) {
    return {
      title: str(b.title, '할 일 제목'),
      due_date: date(b.due_date, '마감일', false),
      priority: oneOf(b.priority, PRIORITIES, '우선순위'),
      estimated_minutes: minutes(b.estimated_minutes, '예상 시간'),
      tags: tagList(b.tags),
      ...(partial ? {} : { plan_id: Number(b.plan_id) }),
    };
  }
  function setTags(id, tags) { run('DELETE FROM task_tags WHERE task_id = ?', id); tags.forEach((g) => run('INSERT INTO task_tags (task_id, tag) VALUES (?,?)', id, g)); }
  function createTask(b) {
    const f = taskFields(b, false); getPlan(f.plan_id); const t = nowIso();
    return tx(() => {
      const r = run("INSERT INTO tasks (plan_id, title, status, due_date, priority, estimated_minutes, created_at, updated_at) VALUES (?,?,'todo',?,?,?,?,?)", f.plan_id, f.title, f.due_date, f.priority, f.estimated_minutes, t, t);
      const id = Number(r.lastInsertRowid); setTags(id, f.tags); return getTask(id);
    });
  }
  function updateTask(id, b) {
    const cur = getTask(id); const f = taskFields(b, true);
    let status = cur.status;
    if (b.status !== undefined && b.status !== cur.status) {
      status = oneOf(b.status, STATUSES, '상태');
      if (status === 'done') throw bad('완료 처리는 완료 버튼(/complete)을 사용하세요.');
    }
    return tx(() => {
      if (cur.status === 'done' && status !== 'done') run('DELETE FROM completions WHERE task_id = ?', id);
      run('UPDATE tasks SET title=?, due_date=?, priority=?, estimated_minutes=?, status=?, updated_at=? WHERE id=?', f.title, f.due_date, f.priority, f.estimated_minutes, status, nowIso(), id);
      setTags(id, f.tags); return getTask(id);
    });
  }
  function completeTask(id, b) {
    getTask(id);
    const key = str(b.idempotency_key, '멱등성 키(idempotency_key)', 100);
    return tx(() => {
      const byKey = get('SELECT * FROM completions WHERE idempotency_key = ?', key);
      const byTask = get('SELECT * FROM completions WHERE task_id = ?', id);
      if (byKey && byKey.task_id !== id) throw new HttpError(409, '이 멱등성 키는 다른 할 일에 사용되었습니다.');
      let duplicate = true;
      if (!byKey && !byTask) {
        run('INSERT INTO completions (task_id, idempotency_key, completed_at) VALUES (?,?,?)', id, key, nowIso());
        duplicate = false;
      }
      run("UPDATE tasks SET status='done', updated_at=? WHERE id=? AND status != 'done'", nowIso(), id);
      return { duplicate, task: getTask(id) };
    });
  }
  function deleteTask(id) { getTask(id); run('DELETE FROM tasks WHERE id = ?', id); return { deleted: true }; }

  // ---------- runs ----------
  function listRuns(q) {
    const w = ['1=1']; const p = [];
    if (q.task_id) { w.push('r.task_id = ?'); p.push(Number(q.task_id)); }
    if (q.plan_id) { w.push('t.plan_id = ?'); p.push(Number(q.plan_id)); }
    return plainAll(all(`SELECT r.*, t.title AS task_title, t.plan_id, p.title AS plan_title FROM runs r JOIN tasks t ON t.id = r.task_id JOIN plans p ON p.id = t.plan_id WHERE ${w.join(' AND ')} ORDER BY r.started_at DESC, r.id DESC`, ...p));
  }
  function createRun(b) {
    const task = getTask(Number(b.task_id));
    const started = isoTime(b.started_at, '시작 시각'); const ended = isoTime(b.ended_at, '종료 시각');
    if (ended < started) throw bad('종료 시각은 시작 시각보다 빠를 수 없습니다.');
    let actual = minutes(b.actual_minutes, '실제 소요 시간', false);
    if (actual === null) actual = Math.round((Date.parse(ended) - Date.parse(started)) / 60000);
    const blocked = str(b.blocked_reason, '막힘 사유', 500, false) || null;
    const r = run('INSERT INTO runs (task_id, started_at, ended_at, actual_minutes, blocked_reason, created_at) VALUES (?,?,?,?,?,?)', task.id, started, ended, actual, blocked, nowIso());
    return plain(get('SELECT * FROM runs WHERE id = ?', Number(r.lastInsertRowid)));
  }
  function deleteRun(id) { if (!get('SELECT 1 x FROM runs WHERE id = ?', id)) throw new HttpError(404, '실행 기록을 찾을 수 없습니다.'); run('DELETE FROM runs WHERE id = ?', id); return { deleted: true }; }

  // ---------- retro ----------
  function scopePlans(q) {
    const w = ['1=1']; const p = [];
    if (q.plan_id) { w.push('id = ?'); p.push(Number(q.plan_id)); }
    if (q.from) { w.push('period_end >= ?'); p.push(date(q.from, '시작 기준일')); }
    if (q.to) { w.push('period_start <= ?'); p.push(date(q.to, '종료 기준일')); }
    return plainAll(all(`SELECT * FROM plans WHERE ${w.join(' AND ')} ORDER BY period_start, id`, ...p));
  }
  function metricsFor(planIds) {
    const m = { plans: planIds.length, tasks: 0, done: 0, overdue: 0, blocked: 0, estimated_minutes: 0, actual_minutes: 0, diff_minutes: 0 };
    if (!planIds.length) return m;
    const tasks = taskRows(`t.plan_id IN (${planIds.map(() => '?').join(',')})`, planIds);
    m.tasks = tasks.length;
    m.done = tasks.filter((t) => t.status === 'done').length;
    m.overdue = tasks.filter((t) => t.overdue).length; // 완료한 할 일은 지연으로 세지 않음 → 중복 집계 없음
    m.estimated_minutes = tasks.reduce((s, t) => s + t.estimated_minutes, 0);
    m.actual_minutes = tasks.reduce((s, t) => s + t.actual_minutes, 0);
    m.blocked = get(`SELECT COUNT(DISTINCT r.task_id) c FROM runs r JOIN tasks t ON t.id = r.task_id WHERE t.plan_id IN (${planIds.map(() => '?').join(',')}) AND r.blocked_reason IS NOT NULL AND TRIM(r.blocked_reason) != ''`, ...planIds).c;
    m.diff_minutes = m.tasks ? m.actual_minutes - m.estimated_minutes : 0;
    return m;
  }
  function retro(q) {
    const plans = scopePlans(q);
    const summary = metricsFor(plans.map((p) => p.id));
    const per_plan = plans.map((p) => ({ plan: p, metrics: metricsFor([p.id]), notes: plainAll(all('SELECT * FROM retro_notes WHERE plan_id = ? ORDER BY id', p.id)) }));
    return { today: today(), unit: 'minutes', scope: { plan_id: q.plan_id || null, from: q.from || null, to: q.to || null }, summary, per_plan };
  }
  const METRIC_LABEL = {
    plans: ['계획 수', '범위에 포함된 계획'],
    tasks: ['할 일 수', '범위 계획에 속하며 삭제되지 않은 할 일'],
    done: ['완료 수', '현재 상태가 완료(done)인 할 일'],
    overdue: ['지연 수', `미완료이면서 마감일이 서울 시간 기준 오늘(${today()})보다 앞선 할 일 (완료한 할 일은 제외)`],
    blocked: ['막힘 수', '막힘 사유가 하나 이상 기록된 실행 기록이 있는 할 일 (할 일 기준 중복 없음)'],
    estimated_minutes: ['예상 시간 합계(분)', '대상 할 일의 예상 시간 합'],
    actual_minutes: ['실제 시간 합계(분)', '대상 할 일에 연결된 실행 기록의 실제 소요 시간 합'],
    diff_minutes: ['차이(분)', '실제 시간 − 예상 시간 (대상 할 일이 없으면 0)'],
  };
  function evidence(q) {
    const metric = q.metric;
    if (!METRIC_LABEL[metric]) throw bad('알 수 없는 집계 항목입니다.');
    const plans = scopePlans(q); const ids = plans.map((p) => p.id);
    const ev = { metric, label: METRIC_LABEL[metric][0], rule: METRIC_LABEL[metric][1], plans: [], tasks: [], runs: [] };
    const taskAll = ids.length ? taskRows(`t.plan_id IN (${ids.map(() => '?').join(',')})`, ids) : [];
    const runsAll = ids.length ? plainAll(all(`SELECT r.*, t.title AS task_title, t.plan_id FROM runs r JOIN tasks t ON t.id = r.task_id WHERE t.plan_id IN (${ids.map(() => '?').join(',')}) ORDER BY r.started_at, r.id`, ...ids)) : [];
    if (metric === 'plans') ev.plans = plans;
    else if (metric === 'tasks' || metric === 'estimated_minutes') ev.tasks = taskAll;
    else if (metric === 'done') ev.tasks = taskAll.filter((t) => t.status === 'done');
    else if (metric === 'overdue') ev.tasks = taskAll.filter((t) => t.overdue);
    else if (metric === 'blocked') { ev.runs = runsAll.filter((r) => r.blocked_reason && r.blocked_reason.trim()); const set = new Set(ev.runs.map((r) => r.task_id)); ev.tasks = taskAll.filter((t) => set.has(t.id)); }
    else if (metric === 'actual_minutes') { ev.runs = runsAll; ev.tasks = taskAll.filter((t) => t.run_count > 0); }
    else if (metric === 'diff_minutes') { ev.tasks = taskAll; ev.runs = runsAll; }
    return ev;
  }
  function createNote(b) {
    getPlan(Number(b.plan_id)); const note = str(b.note, '개선점', 500);
    const r = run('INSERT INTO retro_notes (plan_id, note, created_at) VALUES (?,?,?)', Number(b.plan_id), note, nowIso());
    return plain(get('SELECT * FROM retro_notes WHERE id = ?', Number(r.lastInsertRowid)));
  }
  function applyNote(id, b) {
    const n = get('SELECT * FROM retro_notes WHERE id = ?', id); if (!n) throw new HttpError(404, '개선점을 찾을 수 없습니다.');
    return tx(() => {
      let target = b.plan_id ? Number(b.plan_id) : null;
      if (target) getPlan(target);
      else {
        const src = getPlan(n.plan_id);
        const d = new Date(src.period_end + 'T00:00:00Z');
        const s = new Date(d.getTime() + 86400000); const e = new Date(s.getTime() + (Date.parse(src.period_end) - Date.parse(src.period_start)));
        target = createPlan({ title: `${src.title} (다음 계획)`, period_start: s.toISOString().slice(0, 10), period_end: e.toISOString().slice(0, 10), priority: src.priority, success_criteria: src.success_criteria, estimated_minutes: src.estimated_minutes }).id;
      }
      if (target === n.plan_id) throw bad('다음 계획은 회고 대상 계획과 달라야 합니다.');
      run('UPDATE retro_notes SET applied_plan_id = ? WHERE id = ?', target, id);
      run('UPDATE plans SET improvement_note_id = ?, updated_at = ? WHERE id = ?', id, nowIso(), target);
      return { note: plain(get('SELECT * FROM retro_notes WHERE id = ?', id)), plan: planDetail(target) };
    });
  }

  // ---------- export ----------
  function exportAll() {
    return {
      format: 'pds-export-v2', exported_at: nowIso(), timezone_note: 'dates=YYYY-MM-DD (Asia/Seoul), timestamps=ISO-8601 UTC, durations=minutes',
      plans: plainAll(all('SELECT * FROM plans ORDER BY id')), plan_revisions: plainAll(all('SELECT * FROM plan_revisions ORDER BY plan_id, revision_no')),
      tasks: taskRows().map(({ plan_title, run_count, actual_minutes, overdue, ...t }) => t), runs: plainAll(all('SELECT * FROM runs ORDER BY id')),
      completions: plainAll(all('SELECT * FROM completions ORDER BY id')), retro_notes: plainAll(all('SELECT * FROM retro_notes ORDER BY id')),
      retro: retro({}),
    };
  }

  // ---------- http ----------
  const id = (s) => { const n = Number(s); if (!Number.isInteger(n) || n < 1) throw bad('ID가 올바르지 않습니다.'); return n; };
  const routes = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],
    ['GET', /^\/api\/plans$/, () => plainAll(all('SELECT * FROM plans ORDER BY period_start DESC, id DESC')).map((p) => planDetail(p.id))],
    ['POST', /^\/api\/plans$/, (_m, _q, b) => createPlan(b), 201],
    ['GET', /^\/api\/plans\/(\d+)$/, (m) => planDetail(id(m[1]))],
    ['PUT', /^\/api\/plans\/(\d+)$/, (m, _q, b) => updatePlan(id(m[1]), b)],
    ['DELETE', /^\/api\/plans\/(\d+)$/, (m) => { getPlan(id(m[1])); run('DELETE FROM plans WHERE id = ?', id(m[1])); return { deleted: true }; }],
    ['GET', /^\/api\/tasks$/, (_m, q) => listTasks(q)],
    ['POST', /^\/api\/tasks$/, (_m, _q, b) => createTask(b), 201],
    ['GET', /^\/api\/tasks\/(\d+)$/, (m) => getTask(id(m[1]))],
    ['PUT', /^\/api\/tasks\/(\d+)$/, (m, _q, b) => updateTask(id(m[1]), b)],
    ['DELETE', /^\/api\/tasks\/(\d+)$/, (m) => deleteTask(id(m[1]))],
    ['POST', /^\/api\/tasks\/(\d+)\/complete$/, (m, _q, b) => completeTask(id(m[1]), b)],
    ['GET', /^\/api\/runs$/, (_m, q) => listRuns(q)],
    ['POST', /^\/api\/runs$/, (_m, _q, b) => createRun(b), 201],
    ['DELETE', /^\/api\/runs\/(\d+)$/, (m) => deleteRun(id(m[1]))],
    ['GET', /^\/api\/retro$/, (_m, q) => retro(q)],
    ['GET', /^\/api\/retro\/evidence$/, (_m, q) => evidence(q)],
    ['POST', /^\/api\/retro\/notes$/, (_m, _q, b) => createNote(b), 201],
    ['POST', /^\/api\/retro\/notes\/(\d+)\/apply$/, (m, _q, b) => applyNote(id(m[1]), b)],
    ['GET', /^\/api\/export$/, () => exportAll()],
  ];

  const SEC = { 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
  const send = (res, status, body, headers = {}) => { res.writeHead(status, { ...SEC, ...headers }); res.end(body); };
  const sendJson = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, '요청이 너무 큽니다.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(o && typeof o === 'object' ? o : {}); } catch { reject(bad('JSON 형식이 올바르지 않습니다.')); } });
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'); const q = Object.fromEntries(url.searchParams);
      if (url.pathname.startsWith('/api/')) {
        for (const [method, re, fn, okStatus] of routes) {
          const m = re.exec(url.pathname);
          if (m && method === req.method) {
            const body = ['POST', 'PUT'].includes(method) ? await readBody(req) : {};
            const out = fn(m, q, body);
            if (url.pathname === '/api/export') return sendJson(res, 200, out, { 'Content-Disposition': 'attachment; filename="pds-diary-export.json"' });
            return sendJson(res, okStatus || 200, out);
          }
        }
        if (routes.some(([, re]) => re.test(url.pathname))) throw new HttpError(405, '허용되지 않는 메서드입니다.');
        throw new HttpError(404, '존재하지 않는 API입니다.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '허용되지 않는 메서드입니다.');
      let rel = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
      let file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (rel.startsWith('/contracts/')) file = path.normalize(path.join(__dirname, rel)); else throw new HttpError(404, '찾을 수 없습니다.');
        if (!file.startsWith(path.join(__dirname, 'contracts') + path.sep) || !fs.existsSync(file)) throw new HttpError(404, '찾을 수 없습니다.');
      }
      send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    } catch (e) {
      const status = e.status || (/UNIQUE|constraint/i.test(String(e.message)) ? 409 : 500);
      if (status === 500) console.error(e);
      sendJson(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : e.message });
    }
  });
  return { server, db };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  const { server } = createApp();
  server.listen(port, '0.0.0.0', () => console.log(`Plan-Do-See diary on http://localhost:${port}`));
}
module.exports = { createApp };
