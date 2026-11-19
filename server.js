'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { AsyncLocalStorage } = require('node:async_hooks');
const bcrypt = require('bcryptjs');
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
  title: 'LOWER(t.title) {d}',
};

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (m) => new HttpError(400, m);
const nowIso = () => new Date().toISOString();
// ---------- 인증 컨텍스트 ----------
// 요청마다 세션에서 찾은 사용자만 reqCtx 에 넣는다. 주소·헤더·본문에 적힌 사용자 정보는 쓰지 않는다.
const reqCtx = new AsyncLocalStorage();
const uid = () => { const s = reqCtx.getStore(); if (!s || !s.user) throw new HttpError(401, '로그인이 필요합니다.'); return s.user.id; };
const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
const hashToken = (t) => crypto.createHash('sha256').update(t).digest('hex');
const parseCookies = (req) => Object.fromEntries((req.headers.cookie || '').split(';').map((x) => x.trim()).filter(Boolean).map((x) => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
function passwordError(pw) {
  if (typeof pw !== 'string' || Buffer.byteLength(pw) < 8 || Buffer.byteLength(pw) > 72) return '비밀번호는 8자 이상 72바이트 이하여야 합니다.';
  return null;
}
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
function intId(v, name = 'ID') { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 2147483647) throw bad(`${name}이(가) 올바르지 않습니다.`); return n; }
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

async function createApp({ databaseUrl = process.env.DATABASE_URL, schema, today = kstToday, sessionTtlSeconds = Number(process.env.SESSION_TTL_SECONDS) || 3600, bcryptCost = Number(process.env.BCRYPT_COST) || 12 } = {}) {
  const { pool, all, get, run, tx, close } = await openDb(databaseUrl, { schema });

  // ---------- 회원·세션 ----------
  const dummyHash = bcrypt.hash('dummy-password', bcryptCost); // 없는 아이디도 같은 시간 들여 비교(응답 시간 차이 완화)
  const cookieFor = (req, token, maxAge) => {
    const secure = process.env.COOKIE_SECURE === '1' || req.headers['x-forwarded-proto'] === 'https';
    return `sid=${token}; Max-Age=${maxAge}; Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  };
  async function userFromReq(req) {
    const tok = parseCookies(req).sid;
    if (!tok) return null;
    return (await get('SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?', hashToken(tok), nowIso())) || null;
  }
  async function issueSession(req, userId) {
    const tok = crypto.randomBytes(32).toString('base64url'); const c = Date.now();
    await run('DELETE FROM sessions WHERE expires_at <= ?', new Date(c).toISOString()); // 만료된 세션 정리
    await run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)', hashToken(tok), userId, new Date(c).toISOString(), new Date(c + sessionTtlSeconds * 1000).toISOString());
    return cookieFor(req, tok, sessionTtlSeconds);
  }
  const clearCookie = (req) => cookieFor(req, '', 0);
  const verifyPw = async (userId, pw) => {
    const row = await get('SELECT pw_hash FROM users WHERE id = ?', userId);
    return typeof pw === 'string' && !!row && bcrypt.compare(pw, row.pw_hash);
  };
  // 인증 라우트: 처리했으면 true
  async function authRoutes(req, res, url, user, body) {
    const sj = (st, o, h) => sendJson(res, st, o, h);
    if (req.method === 'POST' && url.pathname === '/api/signup') {
      const username = String(body.username || '').trim().toLowerCase();
      if (!USERNAME_RE.test(username)) throw bad('아이디는 영문 소문자·숫자·밑줄 3~32자입니다.');
      const pe = passwordError(body.password); if (pe) throw bad(pe);
      const hash = await bcrypt.hash(body.password, bcryptCost);
      let row;
      try { row = await get('INSERT INTO users (username, pw_hash, created_at) VALUES (?,?,?) RETURNING id', username, hash, nowIso()); }
      catch (e) { if (e.code === '23505') throw new HttpError(409, '이미 사용 중인 아이디입니다.'); throw e; }
      sj(201, { ok: true, username }, { 'Set-Cookie': await issueSession(req, row.id) }); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/login') {
      const username = String(body.username || '').trim().toLowerCase();
      const row = await get('SELECT id, pw_hash FROM users WHERE username = ?', username);
      const ok = await bcrypt.compare(typeof body.password === 'string' ? body.password : '', row ? row.pw_hash : await dummyHash);
      // 아이디 없음 / 비밀번호 틀림: 같은 문구·같은 상태 코드
      if (!row || !ok) throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
      sj(200, { ok: true, username }, { 'Set-Cookie': await issueSession(req, row.id) }); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/logout') {
      const tok = parseCookies(req).sid;
      if (tok) await run('DELETE FROM sessions WHERE token_hash = ?', hashToken(tok)); // 서버에서 세션 무효화
      sj(200, { ok: true }, { 'Set-Cookie': clearCookie(req) }); return true;
    }
    if (url.pathname === '/api/me' && req.method === 'GET') {
      if (!user) throw new HttpError(401, '로그인이 필요합니다.');
      sj(200, { username: user.username, session_expires_at: user.expires_at }); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/password') {
      if (!user) throw new HttpError(401, '로그인이 필요합니다.');
      if (!(await verifyPw(user.id, body.old_password))) throw new HttpError(403, '현재 비밀번호가 올바르지 않습니다.');
      const pe = passwordError(body.new_password); if (pe) throw bad(pe);
      const hash = await bcrypt.hash(body.new_password, bcryptCost);
      await tx(async () => { await run('UPDATE users SET pw_hash = ? WHERE id = ?', hash, user.id); await run('DELETE FROM sessions WHERE user_id = ?', user.id); }); // 이전 세션 모두 무효화
      sj(200, { ok: true, message: '비밀번호가 변경되었습니다. 다시 로그인하세요.' }, { 'Set-Cookie': clearCookie(req) }); return true;
    }
    if (req.method === 'POST' && url.pathname === '/api/account/delete') {
      if (!user) throw new HttpError(401, '로그인이 필요합니다.');
      if (!(await verifyPw(user.id, body.password))) throw new HttpError(403, '비밀번호가 올바르지 않습니다.');
      await run('DELETE FROM users WHERE id = ?', user.id); // 세션·계획·할 일·실행 기록·완료 기록·회고가 ON DELETE CASCADE 로 함께 삭제
      sj(200, { ok: true, message: '계정과 모든 기록이 삭제되었습니다.' }, { 'Set-Cookie': clearCookie(req) }); return true;
    }
    return false;
  }

  // ---------- plans ----------
  const getPlan = async (id) => { const p = await get('SELECT * FROM plans WHERE id = ? AND user_id = ?', id, uid()); if (!p) throw new HttpError(404, '계획을 찾을 수 없습니다.'); return p; };
  async function planDetail(id) {
    const p = await getPlan(id);
    p.revisions = await all('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_no', id);
    p.task_count = (await get('SELECT COUNT(*)::int c FROM tasks WHERE plan_id = ? AND user_id = ?', id, uid())).c;
    p.improvement = p.improvement_note_id ? (await get('SELECT id, note, plan_id AS from_plan_id FROM retro_notes WHERE id = ? AND user_id = ?', p.improvement_note_id, uid())) || null : null;
    return p;
  }
  const REV_SQL = 'INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, estimated_minutes, revised_at, user_id) VALUES (?,?,?,?,?,?,?,?,?,?)';
  async function createPlan(b) {
    const f = planFields(b); const t = nowIso();
    return tx(async () => {
      const r = await get('INSERT INTO plans (title, period_start, period_end, priority, success_criteria, estimated_minutes, created_at, updated_at, user_id) VALUES (?,?,?,?,?,?,?,?,?) RETURNING id', f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t, t, uid());
      await run(REV_SQL, r.id, 0, f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t, uid());
      return planDetail(r.id);
    });
  }
  async function updatePlan(id, b) {
    await getPlan(id); const f = planFields(b); const t = nowIso();
    return tx(async () => {
      await run('UPDATE plans SET title=?, period_start=?, period_end=?, priority=?, success_criteria=?, estimated_minutes=?, updated_at=? WHERE id=? AND user_id=?', f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t, id, uid());
      const n = ((await get('SELECT MAX(revision_no) m FROM plan_revisions WHERE plan_id = ?', id)).m ?? -1) + 1;
      await run(REV_SQL, id, n, f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.estimated_minutes, t, uid());
      return planDetail(id);
    });
  }

  // ---------- tasks ----------
  async function taskRows(where = '1=1', params = [], order = 't.id ASC') {
    const rows = await all(`SELECT t.*, p.title AS plan_title,
        (SELECT completed_at FROM completions c WHERE c.task_id = t.id) AS completed_at,
        (SELECT COUNT(*)::int FROM runs r WHERE r.task_id = t.id) AS run_count,
        (SELECT COALESCE(SUM(actual_minutes),0)::int FROM runs r WHERE r.task_id = t.id) AS actual_minutes
      FROM tasks t JOIN plans p ON p.id = t.plan_id WHERE t.user_id = ? AND ${where} ORDER BY ${order}`, uid(), ...params);
    const tagRows = rows.length ? await all('SELECT task_id, tag FROM task_tags WHERE task_id = ANY(?::int[]) ORDER BY tag', rows.map((r) => r.id)) : [];
    const tags = new Map();
    tagRows.forEach((x) => { if (!tags.has(x.task_id)) tags.set(x.task_id, []); tags.get(x.task_id).push(x.tag); });
    const td = today();
    return rows.map((r) => ({ ...r, tags: tags.get(r.id) || [], overdue: r.status !== 'done' && !!r.due_date && r.due_date < td }));
  }
  const getTask = async (id) => { const r = (await taskRows('t.id = ?', [id]))[0]; if (!r) throw new HttpError(404, '할 일을 찾을 수 없습니다.'); return r; };
  async function listTasks(q) {
    const w = ['1=1']; const p = [];
    if (q.plan_id) { w.push('t.plan_id = ?'); p.push(intId(q.plan_id, '계획 ID')); }
    if (q.status) { w.push('t.status = ?'); p.push(oneOf(q.status, STATUSES, '상태')); }
    if (q.priority) { w.push('t.priority = ?'); p.push(oneOf(q.priority, PRIORITIES, '우선순위')); }
    if (q.tag) { w.push('EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = t.id AND g.tag = ?)'); p.push(q.tag); }
    if (q.due_before) { w.push('t.due_date IS NOT NULL AND t.due_date <= ?'); p.push(date(q.due_before, '마감 기준일')); }
    if (q.overdue === '1') { w.push("t.status != 'done' AND t.due_date IS NOT NULL AND t.due_date < ?"); p.push(today()); }
    if (q.q) {
      const like = '%' + String(q.q).replace(/[\\%_]/g, (c) => '\\' + c) + '%';
      w.push("(t.title ILIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM task_tags g WHERE g.task_id = t.id AND g.tag ILIKE ? ESCAPE '\\'))"); p.push(like, like);
    }
    const sort = q.sort && SORT_SQL[q.sort] ? q.sort : 'due_date';
    const dir = q.dir === 'desc' ? 'desc' : 'asc';
    // 동률이면 id 오름차순(tie-breaker)
    const order = SORT_SQL[sort].replace('{d}', dir.toUpperCase()) + ', t.id ASC';
    return { sort, dir, tie_breaker: 'id asc', tasks: await taskRows(w.join(' AND '), p, order) };
  }
  function taskFields(b, partial) {
    return {
      title: str(b.title, '할 일 제목'),
      due_date: date(b.due_date, '마감일', false),
      priority: oneOf(b.priority, PRIORITIES, '우선순위'),
      estimated_minutes: minutes(b.estimated_minutes, '예상 시간'),
      tags: tagList(b.tags),
      ...(partial ? {} : { plan_id: intId(b.plan_id, '계획 ID') }),
    };
  }
  async function setTags(id, tags) { await run('DELETE FROM task_tags WHERE task_id = ?', id); for (const g of tags) await run('INSERT INTO task_tags (task_id, tag) VALUES (?,?)', id, g); }
  async function createTask(b) {
    const f = taskFields(b, false); await getPlan(f.plan_id); const t = nowIso();
    return tx(async () => {
      const r = await get("INSERT INTO tasks (plan_id, title, status, due_date, priority, estimated_minutes, created_at, updated_at, user_id) VALUES (?,?,'todo',?,?,?,?,?,?) RETURNING id", f.plan_id, f.title, f.due_date, f.priority, f.estimated_minutes, t, t, uid());
      await setTags(r.id, f.tags); return getTask(r.id);
    });
  }
  async function updateTask(id, b) {
    const cur = await getTask(id); const f = taskFields(b, true);
    let status = cur.status;
    if (b.status !== undefined && b.status !== cur.status) {
      status = oneOf(b.status, STATUSES, '상태');
      if (status === 'done') throw bad('완료 처리는 완료 버튼(/complete)을 사용하세요.');
    }
    return tx(async () => {
      if (cur.status === 'done' && status !== 'done') await run('DELETE FROM completions WHERE task_id = ? AND user_id = ?', id, uid());
      await run('UPDATE tasks SET title=?, due_date=?, priority=?, estimated_minutes=?, status=?, updated_at=? WHERE id=? AND user_id=?', f.title, f.due_date, f.priority, f.estimated_minutes, status, nowIso(), id, uid());
      await setTags(id, f.tags); return getTask(id);
    });
  }
  async function completeTask(id, b) {
    await getTask(id);
    const key = str(b.idempotency_key, '멱등성 키(idempotency_key)', 100);
    return tx(async () => {
      const byKey = await get('SELECT task_id FROM completions WHERE idempotency_key = ? AND user_id = ?', key, uid());
      if (byKey && byKey.task_id !== id) throw new HttpError(409, '이 멱등성 키는 다른 할 일에 사용되었습니다.');
      // task_id / idempotency_key UNIQUE 제약 → 동시에 여러 번 눌러도 1건만 삽입된다
      const ins = await run('INSERT INTO completions (task_id, idempotency_key, completed_at, user_id) VALUES (?,?,?,?) ON CONFLICT DO NOTHING', id, key, nowIso(), uid());
      await run("UPDATE tasks SET status='done', updated_at=? WHERE id=? AND user_id=? AND status != 'done'", nowIso(), id, uid());
      return { duplicate: ins.rowCount === 0, task: await getTask(id) };
    });
  }
  async function deleteTask(id) { await getTask(id); await run('DELETE FROM tasks WHERE id = ? AND user_id = ?', id, uid()); return { deleted: true }; }

  // ---------- runs ----------
  async function listRuns(q) {
    const w = ['r.user_id = ?']; const p = [uid()];
    if (q.task_id) { w.push('r.task_id = ?'); p.push(intId(q.task_id, '할 일 ID')); }
    if (q.plan_id) { w.push('t.plan_id = ?'); p.push(intId(q.plan_id, '계획 ID')); }
    return all(`SELECT r.*, t.title AS task_title, t.plan_id, p.title AS plan_title FROM runs r JOIN tasks t ON t.id = r.task_id JOIN plans p ON p.id = t.plan_id WHERE ${w.join(' AND ')} ORDER BY r.started_at DESC, r.id DESC`, ...p);
  }
  async function createRun(b) {
    const task = await getTask(intId(b.task_id, '할 일 ID'));
    const started = isoTime(b.started_at, '시작 시각'); const ended = isoTime(b.ended_at, '종료 시각');
    if (ended < started) throw bad('종료 시각은 시작 시각보다 빠를 수 없습니다.');
    let actual = minutes(b.actual_minutes, '실제 소요 시간', false);
    if (actual === null) actual = Math.round((Date.parse(ended) - Date.parse(started)) / 60000);
    const blocked = str(b.blocked_reason, '막힘 사유', 500, false) || null;
    return get('INSERT INTO runs (task_id, started_at, ended_at, actual_minutes, blocked_reason, created_at, user_id) VALUES (?,?,?,?,?,?,?) RETURNING *', task.id, started, ended, actual, blocked, nowIso(), uid());
  }
  async function deleteRun(id) {
    const r = await run('DELETE FROM runs WHERE id = ? AND user_id = ?', id, uid());
    if (!r.rowCount) throw new HttpError(404, '실행 기록을 찾을 수 없습니다.');
    return { deleted: true };
  }

  // ---------- retro ----------
  async function scopePlans(q) {
    const w = ['user_id = ?']; const p = [uid()];
    if (q.plan_id) { w.push('id = ?'); p.push(intId(q.plan_id, '계획 ID')); }
    if (q.from) { w.push('period_end >= ?'); p.push(date(q.from, '시작 기준일')); }
    if (q.to) { w.push('period_start <= ?'); p.push(date(q.to, '종료 기준일')); }
    return all(`SELECT * FROM plans WHERE ${w.join(' AND ')} ORDER BY period_start, id`, ...p);
  }
  async function metricsFor(planIds) {
    const m = { plans: planIds.length, tasks: 0, done: 0, overdue: 0, blocked: 0, estimated_minutes: 0, actual_minutes: 0, diff_minutes: 0 };
    if (!planIds.length) return m;
    const tasks = await taskRows('t.plan_id = ANY(?::int[])', [planIds]);
    m.tasks = tasks.length;
    m.done = tasks.filter((t) => t.status === 'done').length;
    m.overdue = tasks.filter((t) => t.overdue).length; // 완료한 할 일은 지연으로 세지 않음 → 중복 집계 없음
    m.estimated_minutes = tasks.reduce((s, t) => s + t.estimated_minutes, 0);
    m.actual_minutes = tasks.reduce((s, t) => s + t.actual_minutes, 0);
    m.blocked = (await get("SELECT COUNT(DISTINCT r.task_id)::int c FROM runs r JOIN tasks t ON t.id = r.task_id WHERE t.plan_id = ANY(?::int[]) AND t.user_id = ? AND r.user_id = ? AND r.blocked_reason IS NOT NULL AND TRIM(r.blocked_reason) != ''", planIds, uid(), uid())).c;
    m.diff_minutes = m.tasks ? m.actual_minutes - m.estimated_minutes : 0;
    return m;
  }
  async function retro(q) {
    const plans = await scopePlans(q);
    const summary = await metricsFor(plans.map((p) => p.id));
    const per_plan = [];
    for (const p of plans) per_plan.push({ plan: p, metrics: await metricsFor([p.id]), notes: await all('SELECT * FROM retro_notes WHERE plan_id = ? AND user_id = ? ORDER BY id', p.id, uid()) });
    return { today: today(), unit: 'minutes', scope: { plan_id: q.plan_id || null, from: q.from || null, to: q.to || null }, summary, per_plan };
  }
  const METRIC_LABEL = {
    plans: ['계획 수', '범위에 포함된 계획'],
    tasks: ['할 일 수', '범위 계획에 속하며 삭제되지 않은 할 일'],
    done: ['완료 수', '현재 상태가 완료(done)인 할 일'],
    overdue: ['지연 수', '미완료이면서 마감일이 서울 시간 기준 오늘보다 앞선 할 일 (완료한 할 일은 제외)'],
    blocked: ['막힘 수', '막힘 사유가 하나 이상 기록된 실행 기록이 있는 할 일 (할 일 기준 중복 없음)'],
    estimated_minutes: ['예상 시간 합계(분)', '대상 할 일의 예상 시간 합'],
    actual_minutes: ['실제 시간 합계(분)', '대상 할 일에 연결된 실행 기록의 실제 소요 시간 합'],
    diff_minutes: ['차이(분)', '실제 시간 − 예상 시간 (대상 할 일이 없으면 0)'],
  };
  async function evidence(q) {
    const metric = q.metric;
    if (!METRIC_LABEL[metric]) throw bad('알 수 없는 집계 항목입니다.');
    const plans = await scopePlans(q); const ids = plans.map((p) => p.id);
    const ev = { metric, label: METRIC_LABEL[metric][0], rule: METRIC_LABEL[metric][1], plans: [], tasks: [], runs: [] };
    const taskAll = ids.length ? await taskRows('t.plan_id = ANY(?::int[])', [ids]) : [];
    const runsAll = ids.length ? await all('SELECT r.*, t.title AS task_title, t.plan_id FROM runs r JOIN tasks t ON t.id = r.task_id WHERE t.plan_id = ANY(?::int[]) AND r.user_id = ? ORDER BY r.started_at, r.id', ids, uid()) : [];
    if (metric === 'plans') ev.plans = plans;
    else if (metric === 'tasks' || metric === 'estimated_minutes') ev.tasks = taskAll;
    else if (metric === 'done') ev.tasks = taskAll.filter((t) => t.status === 'done');
    else if (metric === 'overdue') ev.tasks = taskAll.filter((t) => t.overdue);
    else if (metric === 'blocked') { ev.runs = runsAll.filter((r) => r.blocked_reason && r.blocked_reason.trim()); const set = new Set(ev.runs.map((r) => r.task_id)); ev.tasks = taskAll.filter((t) => set.has(t.id)); }
    else if (metric === 'actual_minutes') { ev.runs = runsAll; ev.tasks = taskAll.filter((t) => t.run_count > 0); }
    else if (metric === 'diff_minutes') { ev.tasks = taskAll; ev.runs = runsAll; }
    return ev;
  }
  async function createNote(b) {
    const planId = intId(b.plan_id, '계획 ID'); await getPlan(planId); const note = str(b.note, '개선점', 500);
    return get('INSERT INTO retro_notes (plan_id, note, created_at, user_id) VALUES (?,?,?,?) RETURNING *', planId, note, nowIso(), uid());
  }
  async function applyNote(id, b) {
    const n = await get('SELECT * FROM retro_notes WHERE id = ? AND user_id = ?', id, uid()); if (!n) throw new HttpError(404, '개선점을 찾을 수 없습니다.');
    return tx(async () => {
      let target = b.plan_id ? intId(b.plan_id, '계획 ID') : null;
      if (target) await getPlan(target);
      else {
        const src = await getPlan(n.plan_id);
        const s = new Date(new Date(src.period_end + 'T00:00:00Z').getTime() + 86400000);
        const e = new Date(s.getTime() + (Date.parse(src.period_end) - Date.parse(src.period_start)));
        target = (await createPlan({ title: `${src.title} (다음 계획)`, period_start: s.toISOString().slice(0, 10), period_end: e.toISOString().slice(0, 10), priority: src.priority, success_criteria: src.success_criteria, estimated_minutes: src.estimated_minutes })).id;
      }
      if (target === n.plan_id) throw bad('다음 계획은 회고 대상 계획과 달라야 합니다.');
      await run('UPDATE retro_notes SET applied_plan_id = ? WHERE id = ? AND user_id = ?', target, id, uid());
      await run('UPDATE plans SET improvement_note_id = ?, updated_at = ? WHERE id = ? AND user_id = ?', id, nowIso(), target, uid());
      return { note: await get('SELECT * FROM retro_notes WHERE id = ? AND user_id = ?', id, uid()), plan: await planDetail(target) };
    });
  }

  // ---------- export ----------
  async function exportAll() {
    const tasks = (await taskRows()).map(({ plan_title, run_count, actual_minutes, overdue, ...t }) => t);
    return {
      format: 'pds-export-v2', exported_at: nowIso(), timezone_note: 'dates=YYYY-MM-DD (Asia/Seoul), timestamps=ISO-8601 UTC, durations=minutes',
      plans: await all('SELECT * FROM plans WHERE user_id = ? ORDER BY id', uid()), plan_revisions: await all('SELECT * FROM plan_revisions WHERE user_id = ? ORDER BY plan_id, revision_no', uid()),
      tasks, runs: await all('SELECT * FROM runs WHERE user_id = ? ORDER BY id', uid()),
      completions: await all('SELECT * FROM completions WHERE user_id = ? ORDER BY id', uid()), retro_notes: await all('SELECT * FROM retro_notes WHERE user_id = ? ORDER BY id', uid()),
      retro: await retro({}),
    };
  }

  // ---------- http ----------
  const id = (s) => intId(s);
  const routes = [
    ['GET', /^\/api\/health$/, async () => { await get('SELECT 1 AS ok'); return { ok: true }; }],
    ['GET', /^\/api\/plans$/, async () => { const rows = await all('SELECT id FROM plans WHERE user_id = ? ORDER BY period_start DESC, id DESC', uid()); const out = []; for (const r of rows) out.push(await planDetail(r.id)); return out; }],
    ['POST', /^\/api\/plans$/, (_m, _q, b) => createPlan(b), 201],
    ['GET', /^\/api\/plans\/(\d+)$/, (m) => planDetail(id(m[1]))],
    ['PUT', /^\/api\/plans\/(\d+)$/, (m, _q, b) => updatePlan(id(m[1]), b)],
    ['DELETE', /^\/api\/plans\/(\d+)$/, async (m) => { await getPlan(id(m[1])); await run('DELETE FROM plans WHERE id = ? AND user_id = ?', id(m[1]), uid()); return { deleted: true }; }],
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
  const sendJson = (res, status, obj, headers = {}) => send(res, status, JSON.stringify(obj, (k, v) => (k === 'user_id' ? undefined : v)), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  const readBody = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) { reject(new HttpError(413, '요청이 너무 큽니다.')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { if (!chunks.length) return resolve({}); try { const o = JSON.parse(Buffer.concat(chunks).toString('utf8')); resolve(o && typeof o === 'object' ? o : {}); } catch { reject(bad('JSON 형식이 올바르지 않습니다.')); } });
    req.on('error', reject);
  });

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x'); const q = Object.fromEntries(url.searchParams);
      const user = await userFromReq(req);   // 사용자는 오직 세션 쿠키로만 결정한다
      reqCtx.enterWith({ user });
      if (url.pathname.startsWith('/api/')) {
        // 상태를 바꾸는 요청은 커스텀 헤더 필수(다른 사이트의 폼 전송 차단) + SameSite=Strict 쿠키
        if (!['GET', 'HEAD'].includes(req.method) && req.headers['x-requested-with'] !== 'diary') throw bad('잘못된 요청입니다.');
        const reqBody = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : {}; // 본문은 한 번만 읽는다
        if (await authRoutes(req, res, url, user, reqBody)) return;
        if (url.pathname !== '/api/health' && !user) throw new HttpError(401, '로그인이 필요합니다.');
        for (const [method, re, fn, okStatus] of routes) {
          const m = re.exec(url.pathname);
          if (m && method === req.method) {
            const out = await fn(m, q, reqBody);
            if (url.pathname === '/api/export') return sendJson(res, 200, out, { 'Content-Disposition': 'attachment; filename="pds-diary-export.json"' });
            return sendJson(res, okStatus || 200, out);
          }
        }
        if (routes.some(([, re]) => re.test(url.pathname))) throw new HttpError(405, '허용되지 않는 메서드입니다.');
        throw new HttpError(404, '존재하지 않는 API입니다.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, '허용되지 않는 메서드입니다.');
      // 화면 게이트: 로그인 안 했으면 내 자료 화면(/) 대신 로그인 화면으로 보낸다
      const redirect = (to) => send(res, 302, '', { Location: to, 'Cache-Control': 'no-store' });
      if ((url.pathname === '/' || url.pathname === '/index.html') && !user) return redirect('/login');
      if ((url.pathname === '/login' || url.pathname === '/signup') && user) return redirect('/');
      const PAGES = { '/login': '/login.html', '/signup': '/signup.html' };
      const rel = url.pathname === '/' ? '/index.html' : (PAGES[url.pathname] || decodeURIComponent(url.pathname));
      let file = path.normalize(path.join(PUBLIC_DIR, rel));
      if (!file.startsWith(PUBLIC_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
        if (rel.startsWith('/contracts/')) file = path.normalize(path.join(__dirname, rel)); else throw new HttpError(404, '찾을 수 없습니다.');
        if (!file.startsWith(path.join(__dirname, 'contracts') + path.sep) || !fs.existsSync(file)) throw new HttpError(404, '찾을 수 없습니다.');
      }
      send(res, 200, fs.readFileSync(file), { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.extname(file) === '.html' ? 'no-store' : 'no-cache' });
    } catch (e) {
      const status = e.status || (e.code === '23505' ? 409 : 500);
      if (status === 500) console.error(e);
      sendJson(res, status, { error: status === 500 ? '서버 오류가 발생했습니다.' : e.status ? e.message : '이미 존재하는 값입니다.' });
    }
  });
  return { server, pool, get, all, run, close };
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().then(({ server }) => {
    server.listen(port, '0.0.0.0', () => console.log(`Plan-Do-See diary on http://localhost:${port}`));
  }).catch((e) => { console.error('시작 실패:', e.message); process.exit(1); });
}
module.exports = { createApp };
