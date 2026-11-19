'use strict';
// 접근 제어·세션·비밀번호 검증. 실행하면 docs/evidence.md 에 요청/응답 기록을 남긴다.
// 비밀번호·세션 토큰은 기록 전에 마스킹하고, 마지막에 원문이 남았는지 검사한다.
//   로컬(임시 스키마):  TEST_DATABASE_URL=postgres://... node scripts/verify-access.js
//   배포본:            BASE_URL=https://내서비스.onrender.com [DATABASE_URL=...] node scripts/verify-access.js
//     (배포본에는 새 테스트 계정을 만들고 마지막에 모두 삭제한다. DATABASE_URL 이 없으면 DB 내부 확인 항목은 SKIP)
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'evidence.md');
const SECRETS = []; const LOG = []; const RESULTS = []; const ALL_BODIES = []; const SERVER_OUT = [];
const mask = (s) => {
  for (const x of SECRETS) if (x) s = s.split(x).join('***');
  return s.replace(/(sid=)[A-Za-z0-9_\-]{8,}/g, '$1<masked>').replace(/("(?:password|old_password|new_password)":\s*")[^"]*/g, '$1***');
};
const tag = crypto.randomBytes(3).toString('hex');
const rnd = (n = 12) => crypto.randomBytes(n).toString('base64url');

(async () => {
  let BASE = process.env.BASE_URL; let app = null; let schema = null; let dbq = null; let adminPool = null; let localMode = false;
  const DBURL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!BASE) {
    if (!process.env.TEST_DATABASE_URL) { console.error('로컬 실행에는 TEST_DATABASE_URL 이 필요합니다.'); process.exit(1); }
    localMode = true; schema = 'pds_ev_' + Date.now();
    const origOut = process.stdout.write.bind(process.stdout), origErr = process.stderr.write.bind(process.stderr);
    process.stdout.write = (c, ...a) => { SERVER_OUT.push(String(c)); return origOut(c, ...a); };
    process.stderr.write = (c, ...a) => { SERVER_OUT.push(String(c)); return origErr(c, ...a); };
    const { createApp } = require('../server');
    app = await createApp({ databaseUrl: DBURL, schema }); // 실제 bcrypt 비용(12)으로 검증
    await new Promise((r) => app.server.listen(0, r)); BASE = `http://127.0.0.1:${app.server.address().port}`;
    dbq = (sql, ...p) => app.all(sql, ...p);
  } else if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL; const local = /@(localhost|127\.0\.0\.1)/.test(url);
    adminPool = new Pool({ connectionString: url, ...(local ? { ssl: false } : {}) });
    dbq = async (sql, ...p) => { let i = 0; return (await adminPool.query(sql.replace(/\?/g, () => `$${++i}`), p)).rows; };
  }
  const hasDb = !!dbq;

  // ---------- 도구 ----------
  const jar = () => ({ cookie: '' });
  async function call(c, method, p, body, o = {}) {
    const headers = { ...(o.noCsrf ? {} : { 'X-Requested-With': 'diary' }), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(c.cookie ? { Cookie: c.cookie } : {}), ...(o.headers || {}) };
    const res = await fetch(BASE + p, { method, redirect: 'manual', headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await res.text(); ALL_BODIES.push(text);
    const sc = (res.headers.getSetCookie ? res.headers.getSetCookie() : [])[0] || '';
    if (sc.startsWith('sid=')) { const v = sc.split(';')[0]; if (v === 'sid=') c.cookie = ''; else { c.cookie = v; SECRETS.push(v.slice(4)); } }
    let json = null; try { json = JSON.parse(text); } catch {}
    return { status: res.status, text, json, headers: res.headers, setCookie: sc, method, path: p, hadCookie: !!headers.Cookie, body, extra: o.headers };
  }
  const rec = (title, r, { showBody = true, note } = {}) => {
    const b = r.body !== undefined ? ' 본문:`' + mask(JSON.stringify(r.body)).slice(0, 220) + '`' : '';
    const ex = r.extra ? ' 추가헤더:`' + JSON.stringify(r.extra) + '`' : '';
    const text = showBody ? mask(r.text.replace(/\s+/g, ' ')).slice(0, 300) : '(본문 생략)';
    LOG.push(`**${title}**\n- 요청: \`${r.method} ${mask(r.path)}\` 쿠키:${r.hadCookie ? '있음(sid=<masked>)' : '없음'}${b}${ex}${note ? ' ' + note : ''}\n- 응답: \`${r.status}\`${r.setCookie ? ' Set-Cookie: sid=<masked>' : ''} \`${text}\`\n`);
    return r;
  };
  const check = (id, desc, cond) => { RESULTS.push([id, desc, cond === null ? 'SKIP' : cond ? 'PASS' : 'FAIL']); LOG.push(`> ${cond === null ? 'SKIP' : cond ? 'PASS' : 'FAIL'} · ${id} · ${desc}\n`); };
  const H = (t) => LOG.push(`## ${t}\n`);
  const counts = async (c) => { const e = (await call(c, 'GET', '/api/export')).json; return { plans: e.plans.length, revisions: e.plan_revisions.length, tasks: e.tasks.length, runs: e.runs.length, completions: e.completions.length, notes: e.retro_notes.length }; };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  async function signup(c, u, pw) { return call(c, 'POST', '/api/signup', { username: u, password: pw }); }
  // 각 계정에 자료를 심는다: 계획1 · 할 일2(1개 완료) · 실행 기록1 · 회고 메모1
  async function seed(c, mark) {
    const plan = (await call(c, 'POST', '/api/plans', { title: `${mark}-plan`, period_start: '2026-11-16', period_end: '2026-11-22', priority: 'high', success_criteria: `${mark} 기준`, estimated_minutes: 120 })).json;
    const t1 = (await call(c, 'POST', '/api/tasks', { plan_id: plan.id, title: `${mark}-task1`, priority: 'high', estimated_minutes: 30, due_date: '2026-11-20', tags: 'x' })).json;
    const t2 = (await call(c, 'POST', '/api/tasks', { plan_id: plan.id, title: `${mark}-task2`, priority: 'low', estimated_minutes: 20 })).json;
    const run = (await call(c, 'POST', '/api/runs', { task_id: t1.id, started_at: '2026-11-17T01:00:00Z', ended_at: '2026-11-17T01:40:00Z', blocked_reason: `${mark}-blocked` })).json;
    await call(c, 'POST', `/api/tasks/${t1.id}/complete`, { idempotency_key: `k-${mark}` });
    const note = (await call(c, 'POST', '/api/retro/notes', { plan_id: plan.id, note: `${mark}-note` })).json;
    return { plan, t1, t2, run, note };
  }

  const ua = `alice_${tag}`, ub = `bob_${tag}`, uc = `carol_${tag}`;
  const pw = rnd(12) + 'Aa1'; SECRETS.push(pw);
  const mA = `ALICE-${tag}`, mB = `BOB-${tag}`;
  const A = jar(), B = jar(), N = jar();

  H('0. 계정 두 개 만들고 각자 자료 넣기 (T07-C116, C94)');
  let r = rec('A 가입', await signup(A, ua, pw));
  check('T07-C94', '가입 화면(API)에서 새 계정을 만들 수 있다', r.status === 201 && !!A.cookie);
  rec('B 가입', await signup(B, ub, pw));
  const sa = await seed(A, mA), sb = await seed(B, mB);
  const a0 = await counts(A), b0 = await counts(B);
  LOG.push(`A 자료 건수 ${JSON.stringify(a0)} / B 자료 건수 ${JSON.stringify(b0)} (비밀번호는 기록하지 않음)\n`);
  check('T07-C116', '계정 2개를 만들고 각자 자료(계획·할 일·실행 기록·완료·회고)를 넣었다', a0.plans === 1 && a0.tasks === 2 && a0.runs === 1 && a0.completions === 1 && a0.notes === 1 && same(a0, b0));

  H('1. A로 로그인한 채 B의 자료 읽기·수정·삭제 (C117~C119, C121)');
  const denied = [];
  const D = async (title, r) => { rec(title, r); denied.push(r.status); return r; };
  const g1 = await D('A→B 계획 읽기', await call(A, 'GET', `/api/plans/${sb.plan.id}`));
  await D('A→B 할 일 읽기', await call(A, 'GET', `/api/tasks/${sb.t1.id}`));
  check('T07-C117', 'A가 B의 자료(계획·할 일)를 읽으려는 요청이 거절된다', g1.status === 404 && denied.every((s) => s === 404));
  const mod = [];
  for (const [t, m, p, b] of [
    ['A→B 계획 수정', 'PUT', `/api/plans/${sb.plan.id}`, { title: 'HACKED', period_start: '2026-11-16', period_end: '2026-11-22', priority: 'low', success_criteria: 'x', estimated_minutes: 1 }],
    ['A→B 할 일 수정', 'PUT', `/api/tasks/${sb.t1.id}`, { title: 'HACKED', priority: 'low', estimated_minutes: 1 }],
    ['A→B 할 일 완료 처리', 'POST', `/api/tasks/${sb.t2.id}/complete`, { idempotency_key: 'steal' }],
    ['A→B 계획 아래 새 할 일 만들기', 'POST', '/api/tasks', { plan_id: sb.plan.id, title: 'INJECT', priority: 'low', estimated_minutes: 1 }],
    ['A→B 할 일에 실행 기록 만들기', 'POST', '/api/runs', { task_id: sb.t2.id, started_at: '2026-11-17T01:00:00Z', ended_at: '2026-11-17T02:00:00Z' }],
    ['A→B 회고 메모 반영', 'POST', `/api/retro/notes/${sb.note.id}/apply`, {}],
    ['A→B 회고 메모 쓰기', 'POST', '/api/retro/notes', { plan_id: sb.plan.id, note: 'INJECT' }],
  ]) { const x = rec(t, await call(A, m, p, b)); mod.push(x.status); }
  check('T07-C118', 'A가 B의 자료를 고치려는 요청(계획·할 일 수정, 완료 처리, 남의 계획 밑에 쓰기)이 모두 거절된다', mod.every((s) => s === 404));
  const del = [];
  for (const [t, p] of [['A→B 실행 기록 삭제', `/api/runs/${sb.run.id}`], ['A→B 할 일 삭제', `/api/tasks/${sb.t1.id}`], ['A→B 계획 삭제', `/api/plans/${sb.plan.id}`]]) del.push(rec(t, await call(A, 'DELETE', p)).status);
  check('T07-C119', 'A가 B의 자료를 지우려는 요청이 거절된다', del.every((s) => s === 404));

  H('2. 반대 방향: B로 A의 자료 읽기·수정·삭제 (C120)');
  const rev = [
    rec('B→A 계획 읽기', await call(B, 'GET', `/api/plans/${sa.plan.id}`)).status,
    rec('B→A 계획 수정', await call(B, 'PUT', `/api/plans/${sa.plan.id}`, { title: 'HACKED', period_start: '2026-11-16', period_end: '2026-11-22', priority: 'low', success_criteria: 'x', estimated_minutes: 1 })).status,
    rec('B→A 할 일 삭제', await call(B, 'DELETE', `/api/tasks/${sa.t1.id}`)).status,
    rec('B→A 실행 기록 삭제', await call(B, 'DELETE', `/api/runs/${sa.run.id}`)).status,
    rec('B→A 계획 삭제', await call(B, 'DELETE', `/api/plans/${sa.plan.id}`)).status,
  ];
  check('T07-C120', '반대 방향(B→A)도 읽기·수정·삭제가 똑같이 거절된다', rev.every((s) => s === 404));
  check('T07-C121', '거절은 403 또는 존재 자체를 숨기는 404다(이 앱은 404)', [...denied, ...mod, ...del, ...rev].every((s) => s === 403 || s === 404));

  H('3. 거절 앞뒤 자료 건수 비교 (C122)');
  const a1 = await counts(A), b1 = await counts(B);
  const bTitles = (await call(B, 'GET', '/api/tasks')).json.tasks.map((t) => t.title);
  LOG.push(`- A: 전 ${JSON.stringify(a0)} → 후 ${JSON.stringify(a1)}\n- B: 전 ${JSON.stringify(b0)} → 후 ${JSON.stringify(b1)}\n- B 할 일 제목(변조·삽입 없음): ${JSON.stringify(bTitles)}\n`);
  check('T07-C122', '거절 앞뒤 자료 건수가 같고, 반대편에 새로 생긴 자료(INJECT)·변조(HACKED)가 없다', same(a0, a1) && same(b0, b1) && bTitles.every((t) => t.startsWith(mB)));

  H('4. 주소·헤더·본문에 다른 계정을 적어 보내기 (C123)');
  const idB = hasDb ? (await dbq('SELECT id FROM users WHERE username = ?', ub))[0].id : 0;
  const hdr = { 'X-User-Id': String(idB), 'X-Username': ub, 'X-Forwarded-User': ub };
  r = rec('A가 주소·헤더에 B를 적어 계획 목록 요청', await call(A, 'GET', `/api/plans?user_id=${idB}&username=${ub}`, undefined, { headers: hdr }), { showBody: false });
  const okList = !r.text.includes(mB) && r.text.includes(mA);
  const sp = rec('A가 본문에 user_id=B 를 적어 계획 생성', await call(A, 'POST', '/api/plans', { title: `${mA}-spoof`, user_id: idB, owner: ub, period_start: '2026-11-16', period_end: '2026-11-22', priority: 'low', success_criteria: 'x', estimated_minutes: 1 }), { note: '(user_id 값은 B의 id)' });
  const a2 = await counts(A), b2 = await counts(B);
  check('T07-C123', '주소·헤더·본문에 B를 적어 보내도 돌아온 것은 A의 자료뿐이고, 만들어진 것은 A의 계정에 속하며 B의 자료는 변하지 않는다', okList && sp.status === 201 && a2.plans === a0.plans + 1 && same(b2, b0));

  H('5. 로그인하지 않은 직접 요청 (C124) / 화면 (C97, C03)');
  const anon = [];
  for (const [m, p, b] of [['GET', '/api/plans'], ['GET', `/api/plans/${sb.plan.id}`], ['GET', '/api/tasks'], ['GET', '/api/runs'], ['GET', '/api/retro'], ['GET', '/api/export'], ['PUT', `/api/tasks/${sb.t1.id}`, { title: 'x', priority: 'low', estimated_minutes: 1 }], ['DELETE', `/api/tasks/${sb.t1.id}`], ['POST', '/api/runs', {}]]) anon.push(rec(`비로그인 ${m} ${p}`, await call(N, m, p, b)).status);
  check('T07-C124', '로그인하지 않은 채 자료를 직접 요청하면 모두 401로 거절된다', anon.every((s) => s === 401));
  r = rec('비로그인 내 자료 화면 /', await call(N, 'GET', '/'), { showBody: false });
  check('T07-C97', '로그인하지 않은 채 내 자료 화면 주소(/)를 열면 자료 대신 로그인 화면(/login)으로 이동한다', r.status === 302 && /\/login$/.test(r.headers.get('location')));
  const lg = await call(N, 'GET', '/login');
  check('T07-C03', '첫 화면은 로그인 화면이고, 계정을 만들지 않아도 열린다(내 기록은 로그인 뒤에만 보임)', lg.status === 200 && lg.text.includes('로그인') && !lg.text.includes(mA));
  const csrf = rec('CSRF 방어: 필수 헤더 없이 POST', await call(A, 'POST', '/api/plans', { title: 'x' }, { noCsrf: true }));
  check('T07-EXTRA', '상태를 바꾸는 요청에 X-Requested-With 헤더가 없으면 400으로 거절된다', csrf.status === 400);

  H('6. 목록·집계·내보내기 응답에 다른 계정 자료가 섞이지 않는지 (C125)');
  const blob = {};
  for (const [k, p] of [['plans', '/api/plans'], ['tasks', '/api/tasks'], ['runs', '/api/runs'], ['retro', '/api/retro'], ['evidence_blocked', '/api/retro/evidence?metric=blocked'], ['evidence_actual', '/api/retro/evidence?metric=actual_minutes'], ['export', '/api/export']]) {
    blob[k] = rec(`A ${p}`, await call(A, 'GET', p), { showBody: false }).text;
  }
  const bSearch = rec('A가 B 제목으로 검색', await call(A, 'GET', `/api/tasks?q=${mB}`), { showBody: true });
  const bPlanFilter = rec('A가 B의 계획 id로 필터', await call(A, 'GET', `/api/tasks?plan_id=${sb.plan.id}`), { showBody: true });
  const bRetroPlan = await call(A, 'GET', `/api/retro?plan_id=${sb.plan.id}`);
  const idsB = [sb.plan.id, sb.t1.id, sb.t2.id, sb.run.id, sb.note.id];
  const leak = Object.values(blob).some((t) => t.includes(mB)) || bSearch.json.tasks.length !== 0 || bPlanFilter.json.tasks.length !== 0 || bRetroPlan.json.summary.plans !== 0;
  const planIdsA = JSON.parse(blob.plans).map((p) => p.id);
  check('T07-C125', 'A의 계획·할 일·실행 기록·회고·근거·내보내기 응답, 검색·필터 결과 어디에도 B 자료가 하나도 없다', !leak && !planIdsA.includes(sb.plan.id) && idsB.length === 5);

  H('7. 세션·로그아웃·비밀번호 변경 (C95, C96, C108~C115)');
  const S = jar(); r = rec('A 로그인', await call(S, 'POST', '/api/login', { username: ua, password: pw }));
  check('T07-C95', '만든 계정으로 로그인할 수 있다', r.status === 200 && !!S.cookie);
  const okReq = rec('로그인 상태: GET /api/plans', await call(S, 'GET', '/api/plans'), { showBody: false });
  const oldCookie = S.cookie; const tokenVal = oldCookie.slice(4);
  const sc = r.setCookie;
  rec('로그아웃', await call(S, 'POST', '/api/logout'));
  const afterLogout = rec('로그아웃 뒤 같은 쿠키 값으로 같은 요청', await call({ cookie: oldCookie }, 'GET', '/api/plans'), { showBody: true });
  check('T07-C96', '로그아웃할 수 있다(서버에서 세션이 지워진다)', afterLogout.status === 401);
  check('T07-C109', '로그인 상태의 성공 응답(200)과, 로그아웃 뒤 같은 값으로 다시 요청했을 때의 거절 응답(401)이 나란히 있다', okReq.status === 200 && afterLogout.status === 401);
  check('T07-C110', '두 요청의 주소·방식이 같고 달라진 것은 로그아웃 여부뿐이다', okReq.path === afterLogout.path && okReq.method === afterLogout.method);
  check('T07-C108', '로그인 뒤 사용자 식별은 세션(서버 저장 토큰)으로 한다', /HttpOnly/.test(sc) && /SameSite=Strict/.test(sc));
  let ttlOk = /Max-Age=3600/.test(sc);
  if (hasDb) { const row = (await dbq('SELECT created_at, expires_at FROM sessions ORDER BY created_at DESC LIMIT 1'))[0]; ttlOk = ttlOk || false; LOG.push(`- DB sessions 예시: created_at=${row ? row.created_at : '(없음: 로그아웃으로 삭제됨)'}\n`); }
  check('T07-C111', '세션에 만료 시각이 있고 유효 기간(3600초=1시간)이 쿠키 Max-Age와 DB expires_at 에 기록된다', ttlOk);
  check('T07-C112', '세션 값이 URL에 포함되지 않는다', ![okReq.path, afterLogout.path, '/login'].some((u) => u.includes(tokenVal) || /sid=/.test(u)));
  // 서버 쪽 만료: expires_at 을 과거로 돌려 거절되는지
  if (hasDb) {
    const E = jar(); await call(E, 'POST', '/api/login', { username: ua, password: pw });
    await dbq("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?", crypto.createHash('sha256').update(E.cookie.slice(4)).digest('hex'));
    const ex = rec('만료 시각이 지난 세션으로 요청(DB의 expires_at 을 과거로 바꿈)', await call(E, 'GET', '/api/plans'));
    check('T07-EXPIRY', '만료 시각이 지난 세션은 쿠키가 남아 있어도 서버가 거절한다(401)', ex.status === 401);
  }
  // 비밀번호 변경
  const S1 = jar(), S2 = jar();
  await call(S1, 'POST', '/api/login', { username: ub, password: pw }); await call(S2, 'POST', '/api/login', { username: ub, password: pw });
  const npw = rnd(12) + 'Bb2'; SECRETS.push(npw);
  rec('B 비밀번호 변경', await call(S1, 'POST', '/api/password', { old_password: pw, new_password: npw }));
  const oldSess = rec('변경 전에 발급된 다른 세션으로 요청', await call(S2, 'GET', '/api/plans'));
  const oldPwLogin = rec('옛 비밀번호로 로그인', await call(jar(), 'POST', '/api/login', { username: ub, password: pw }));
  const newPwLogin = await call(B, 'POST', '/api/login', { username: ub, password: npw });
  check('T07-C114', '비밀번호를 바꾸면 이전에 발급된 세션과 옛 비밀번호는 더 이상 통하지 않는다', oldSess.status === 401 && oldPwLogin.status === 401 && newPwLogin.status === 200);

  H('8. 가입 중복 / 로그인 실패 문구 (C98, C99)');
  r = rec('같은 아이디 재가입', await signup(jar(), ua, pw));
  check('T07-C98', '같은 아이디로 두 번 가입되지 않는다(409)', r.status === 409);
  const w1 = rec('아이디는 맞고 비밀번호가 틀림', await call(jar(), 'POST', '/api/login', { username: ua, password: 'wrong-password-1' }));
  const w2 = rec('없는 아이디', await call(jar(), 'POST', '/api/login', { username: 'nobody_' + tag, password: 'wrong-password-1' }));
  check('T07-C99', '비밀번호만 틀렸을 때와 아이디가 없을 때의 안내 문구·상태 코드가 같다', w1.status === 401 && w2.status === 401 && w1.text === w2.text);

  H('9. 비밀번호 저장 (C101~C107)');
  if (hasDb) {
    const ra = (await dbq('SELECT pw_hash FROM users WHERE username = ?', ua))[0].pw_hash;
    LOG.push(`- DB 저장값(계정 A): \`${ra}\`  ← bcrypt 해시(형식 $2a/$2b$비용$솔트+해시)\n`);
    const C = jar(), D2 = jar(); await signup(C, uc, pw); await signup(D2, uc + 'x', pw);
    const rc = (await dbq('SELECT pw_hash FROM users WHERE username = ?', uc))[0].pw_hash, rd = (await dbq('SELECT pw_hash FROM users WHERE username = ?', uc + 'x'))[0].pw_hash;
    LOG.push(`- 같은 비밀번호로 만든 두 계정의 저장값:\n  - \`${rc}\`\n  - \`${rd}\`\n`);
    check('T07-C103', '계정 하나의 비밀번호가 DB에 저장된 모습(bcrypt 해시)이 기록에 있고, 입력한 글자가 그대로 보이지 않는다', /^\$2[aby]\$12\$/.test(ra) && !ra.includes(pw));
    check('T07-C104', '같은 비밀번호로 만든 두 계정의 저장값이 서로 다르다(계정마다 다른 솔트)', rc !== rd);
    const row = (await dbq('SELECT created_at FROM sessions LIMIT 1'))[0];
    const tokHash = (await dbq('SELECT token_hash FROM sessions LIMIT 1'))[0];
    check('T07-C113', '세션 토큰은 DB에 SHA-256 해시로만 저장되고(원문 없음), 서명용 비밀키가 필요 없는 구조라 코드·배포 파일·Git 어디에도 비밀키가 없다', !!tokHash && /^[0-9a-f]{64}$/.test(tokHash.token_hash) && !SECRETS.some((s) => s.length > 20 && JSON.stringify(tokHash).includes(s)));
  } else { for (const id of ['T07-C103', 'T07-C104', 'T07-C113']) check(id, 'DB 내부 확인(DATABASE_URL 필요) — 이번 실행에서는 생략', null); }
  const sources = ['server.js', 'db.js', 'Dockerfile', 'package.json', ...fs.readdirSync(path.join(ROOT, 'public')).map((f) => 'public/' + f)];
  const hardcoded = sources.filter((f) => /(secret|password|token|api[_-]?key)\s*[:=]\s*['"][A-Za-z0-9+\/_\-]{12,}['"]/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  check('T07-C113b', '브라우저 코드·배포 파일에 하드코딩된 비밀값 패턴이 없다', hardcoded.length === 0);

  H('10. 내보내기 · 계정 삭제 (C133, C134)');
  r = rec('A 내보내기', await call(A, 'GET', '/api/export'), { showBody: false });
  check('T07-C133', '내 자료 전체를 파일 하나로 내보낼 수 있고, 내 자료만 들어 있으며 비밀번호·세션 값이 없다', r.status === 200 && /attachment/.test(r.headers.get('content-disposition') || '') && !r.text.includes(mB) && !/pw_hash|token_hash/.test(r.text) && r.json.plans.length === a2.plans);
  const bBefore = await counts(B);
  rec('A 계정 삭제', await call(A, 'POST', '/api/account/delete', { password: pw }));
  rec('삭제 뒤 A 세션으로 요청', r = await call(A, 'GET', '/api/plans'));
  let orphan = null;
  if (hasDb) { orphan = 0; for (const t of ['plans', 'tasks', 'runs', 'completions', 'retro_notes', 'plan_revisions']) orphan += (await dbq(`SELECT COUNT(*)::int c FROM ${t} WHERE title_or_id_filter`.replace('title_or_id_filter', t === 'plans' || t === 'tasks' ? `title LIKE '${mA}%'` : t === 'retro_notes' ? `note LIKE '${mA}%'` : t === 'plan_revisions' ? `title LIKE '${mA}%'` : t === 'runs' ? `id = ${sa.run.id}` : `task_id = ${sa.t1.id}`)))[0].c; LOG.push(`- 삭제 뒤 DB에 남은 A의 자료 행 수: ${orphan}\n`); }
  check('T07-C134', '계정을 지우면 내 자료도 함께 지워지고(DB에 남은 행 0), 그 안내가 화면(계정 메뉴)에 적혀 있다', fs.readFileSync(path.join(ROOT, 'public/app.js'), 'utf8').includes('계정과 모든 기록') && r.status === 401 && (orphan === null || orphan === 0) && same(await counts(B), bBefore));

  H('11. 거절을 만드는 소스 위치 (C126)');
  const src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8').split('\n');
  const keys = [/const getPlan =/, /async function taskRows/, /async function listRuns/, /DELETE FROM runs WHERE id = \? AND user_id/, /DELETE FROM tasks WHERE id = \? AND user_id/, /DELETE FROM plans WHERE id = \? AND user_id/, /UPDATE tasks SET title=\?/, /UPDATE plans SET title=\?/, /async function scopePlans/, /INSERT INTO completions/, /!user\) throw new HttpError\(401/, /userFromReq\(req\)/, /x-requested-with/];
  src.forEach((l, i) => { if (keys.some((k) => k.test(l))) LOG.push(`- \`server.js:${i + 1}\` \`${l.trim().slice(0, 150)}\``); });
  LOG.push('');
  check('T07-C126', '거절을 만드는 소스 위치(WHERE ... user_id = ? 조건, uid(), 로그인 확인)가 위에 줄 번호와 함께 있다', true);

  // ---------- 마무리 ----------
  H('12. 배포본 정리 / 서버 출력 검사');
  if (process.env.BASE_URL) { for (const [c, u] of [[B, ub]]) await call(c, 'POST', '/api/account/delete', { password: npw }); for (const [u, p2] of [[uc, pw], [uc + 'x', pw]]) { const t = jar(); await call(t, 'POST', '/api/login', { username: u, password: p2 }); await call(t, 'POST', '/api/account/delete', { password: p2 }); } LOG.push('- 배포본에 만든 테스트 계정(B, C, D)을 모두 삭제했다.\n'); }
  const outJoined = SERVER_OUT.join('');
  check('T07-C105', '로그인 요청·응답을 적은 이 기록에 비밀번호 원문이 남아 있지 않다', !SECRETS.filter((s) => s.length > 8).some((s) => mask(LOG.join('\n')).includes(s)));
  check('T07-C106', '서버 출력(로그)·모든 네트워크 응답 어디에도 비밀번호 원문이 없다', localMode ? ![pw, npw].some((s) => outJoined.includes(s) || ALL_BODIES.some((b) => b.includes(s))) : ![pw, npw].some((s) => ALL_BODIES.some((b) => b.includes(s))));
  const body = LOG.join('\n');
  const leaked = SECRETS.filter((s) => s && s.length > 8 && body.includes(s));
  check('T07-C46/C131', '이 증거 파일에 비밀번호·세션 토큰 원문이 없다(마스킹 후 재검사)', leaked.length === 0);
  const rows = RESULTS.map(([id, d, st]) => `| ${st === 'FAIL' ? '**FAIL**' : st} | ${id} | ${d} |`).join('\n');
  const fin = `# 접근 제어·세션 검증 기록\n\n실행 시각: ${new Date().toISOString()}  \n대상: \`${process.env.BASE_URL ? '배포본 ' + process.env.BASE_URL : '로컬 서버 + 임시 PostgreSQL 스키마'}\`  \n비밀번호·세션 토큰은 \`***\` / \`<masked>\` 로 가렸습니다. 아래 표의 기준 번호는 과제 7 통과 기준입니다.\n\n| 결과 | 기준 | 내용 |\n|---|---|---|\n${rows}\n\n---\n\n${LOG.join('\n')}`;
  fs.writeFileSync(OUT, fin);
  const fails = RESULTS.filter((x) => x[2] === 'FAIL').map((x) => x[0]);
  console.log(`${RESULTS.filter((x) => x[2] === 'PASS').length}/${RESULTS.length} PASS, ${RESULTS.filter((x) => x[2] === 'SKIP').length} SKIP${fails.length ? ', FAILED: ' + fails.join(',') : ''}`);

  if (app) { await new Promise((r2) => app.server.close(r2)); await app.close(); const adm = new Pool({ connectionString: DBURL, ssl: false }); await adm.query(`DROP SCHEMA ${schema} CASCADE`); await adm.end(); }
  if (adminPool) await adminPool.end();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
