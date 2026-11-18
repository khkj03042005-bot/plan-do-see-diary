'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { createApp } = require('../server');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pds-'));
  const dbPath = path.join(dir, 't.db');
  const FIXED_TODAY = '2026-11-18';
  let app = createApp({ dbPath, today: () => FIXED_TODAY });
  await new Promise((r) => app.server.listen(0, r));
  const base = () => `http://127.0.0.1:${app.server.address().port}`;
  const call = async (m, u, b) => { const r = await fetch(base() + u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
  let n = 0; const ok = (name) => console.log(`  ✓ ${String(++n).padStart(2, '0')} ${name}`);

  // C04~C07 plan fields
  let r = await call('POST', '/api/plans', { title: '<script>alert(1)</script> 운동', period_start: '2026-11-16', period_end: '2026-11-22', priority: 'high', success_criteria: '주 3회', estimated_minutes: 300 });
  assert.equal(r.status, 201); const plan = r.body;
  assert.equal(plan.period_start, '2026-11-16'); assert.equal(plan.priority, 'high'); assert.equal(plan.success_criteria, '주 3회'); assert.equal(plan.estimated_minutes, 300);
  ok('C04-C07 계획에 기간·우선순위·성공 기준·예상 시간 저장');
  // C08 history
  r = await call('PUT', `/api/plans/${plan.id}`, { title: '운동(수정)', period_start: '2026-11-16', period_end: '2026-11-23', priority: 'medium', success_criteria: '주 4회', estimated_minutes: 400 });
  assert.equal(r.body.id, plan.id); assert.equal(r.body.title, '운동(수정)');
  assert.equal(r.body.revisions.length, 2); assert.equal(r.body.revisions[0].revision_no, 0);
  assert.equal(r.body.revisions[0].title, '<script>alert(1)</script> 운동'); assert.equal(r.body.revisions[0].estimated_minutes, 300);
  ok('C08 수정해도 최초 계획 보존, ID 유지');
  r = await call('POST', '/api/plans', { title: '', period_start: '2026-11-16' }); assert.equal(r.status, 400); ok('입력 검증 400');
  r = await call('POST', '/api/plans', { title: 'x', period_start: '2026-11-20', period_end: '2026-11-10', priority: 'low', success_criteria: 'a', estimated_minutes: 1 }); assert.equal(r.status, 400); ok('기간 역전 거부');

  // tasks
  const mk = async (o) => (await call('POST', '/api/tasks', { plan_id: plan.id, priority: 'medium', estimated_minutes: 30, ...o })).body;
  const t1 = await mk({ title: '스쿼트', due_date: '2026-11-17', priority: 'high', estimated_minutes: 60, tags: 'gym, leg' });
  const t2 = await mk({ title: '달리기', due_date: '2026-11-18', priority: 'low', estimated_minutes: 45, tags: 'cardio' });
  const t3 = await mk({ title: '스트레칭', due_date: '2026-11-18', priority: 'medium', estimated_minutes: 15 });
  const t4 = await mk({ title: '식단 기록', due_date: '2026-11-20', estimated_minutes: 20, tags: 'diet' });
  const t5 = await mk({ title: '수면 점검', estimated_minutes: 10 });
  assert.equal(t1.due_date, '2026-11-17'); assert.equal(t1.priority, 'high'); assert.deepEqual(t1.tags, ['gym', 'leg']); assert.equal(t1.estimated_minutes, 60);
  ok('C09/C14-C17 할 일 생성: 마감일·우선순위·태그·예상 시간');
  r = await call('PUT', `/api/tasks/${t3.id}`, { title: '스트레칭 15분', due_date: '2026-11-19', priority: 'medium', estimated_minutes: 15, tags: 'cardio' });
  assert.equal(r.body.title, '스트레칭 15분'); ok('C10 수정');

  // C18-C20 search/filter/sort
  r = await call('GET', '/api/tasks?q=' + encodeURIComponent('달리')); assert.deepEqual(r.body.tasks.map((t) => t.id), [t2.id]);
  r = await call('GET', '/api/tasks?tag=cardio'); assert.deepEqual(r.body.tasks.map((t) => t.id).sort(), [t2.id, t3.id].sort()); ok('C18 검색/태그');
  r = await call('GET', '/api/tasks?priority=high'); assert.deepEqual(r.body.tasks.map((t) => t.id), [t1.id]);
  r = await call('GET', '/api/tasks?q=%25'); assert.equal(r.body.tasks.length, 0); ok('C19 필터링 (LIKE 와일드카드 이스케이프)');
  r = await call('GET', '/api/tasks?sort=due_date&dir=asc'); assert.deepEqual(r.body.tasks.map((t) => t.id), [t1.id, t2.id, t3.id, t4.id, t5.id]); assert.equal(r.body.tie_breaker, 'id asc');
  r = await call('GET', '/api/tasks?sort=due_date&dir=desc'); assert.deepEqual(r.body.tasks.map((t) => t.id), [t4.id, t3.id, t2.id, t1.id, t5.id]);
  r = await call('GET', '/api/tasks?sort=priority&dir=asc'); assert.deepEqual(r.body.tasks.map((t) => t.id), [t1.id, t3.id, t4.id, t5.id, t2.id]);
  const a = await call('GET', '/api/tasks?sort=priority'); const b = await call('GET', '/api/tasks?sort=priority'); assert.deepEqual(a.body, b.body);
  ok('C20 정렬 + 동률 시 ID tie-breaker, 조회마다 동일');

  // C30 overdue: t1(11-17) overdue, t2(11-18 오늘) not
  let ret = (await call('GET', '/api/retro')).body;
  assert.equal(ret.summary.overdue, 1); assert.equal(ret.summary.tasks, 5);
  r = await call('POST', `/api/tasks/${t1.id}/complete`, { idempotency_key: 'k1' }); assert.equal(r.body.task.status, 'done');
  ret = (await call('GET', '/api/retro')).body; assert.equal(ret.summary.overdue, 0, '완료한 할 일은 지연으로 세지 않음'); ok('C30 지연: 오늘 이전 마감 & 미완료, 완료 시 중복 집계 없음');
  // C21/C22 duplicate completion (concurrent + sequential)
  const results = await Promise.all([1, 2, 3, 4].map(() => call('POST', `/api/tasks/${t2.id}/complete`, { idempotency_key: 'same-key' })));
  results.forEach((x) => assert.equal(x.status, 200));
  r = await call('POST', `/api/tasks/${t2.id}/complete`, { idempotency_key: 'another-key' }); assert.equal(r.body.duplicate, true);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM completions WHERE task_id = ?').get(t2.id).c, 1);
  ret = (await call('GET', '/api/retro')).body; assert.equal(ret.summary.done, 2); ok('C21-C22 완료 연속 요청해도 완료 기록 1건, 회고 완료 수 +1');
  assert.throws(() => app.db.prepare('INSERT INTO completions (task_id, idempotency_key, completed_at) VALUES (?,?,?)').run(t2.id, 'zzz', 'x'), /UNIQUE/); ok('DB UNIQUE 제약이 중복 방지');
  assert.equal((await call('PUT', `/api/tasks/${t3.id}`, { title: 'x', priority: 'low', estimated_minutes: 1, status: 'done' })).status, 400);
  // C11/C12 complete / revert
  r = await call('PUT', `/api/tasks/${t2.id}`, { ...t2, status: 'doing', tags: ['cardio'] }); assert.equal(r.body.status, 'doing');
  ret = (await call('GET', '/api/retro')).body; assert.equal(ret.summary.done, 1);
  assert.equal(app.db.prepare('SELECT COUNT(*) c FROM completions WHERE task_id = ?').get(t2.id).c, 0);
  r = await call('POST', `/api/tasks/${t2.id}/complete`, { idempotency_key: 'k2' }); assert.equal(r.body.task.status, 'done'); assert.equal(r.body.duplicate, false);
  ok('C11-C12 완료 처리 / 진행 중으로 되돌리기 / 다시 완료');

  // C23-C27 runs
  const planBefore = (await call('GET', `/api/plans/${plan.id}`)).body; const taskBefore = (await call('GET', `/api/tasks/${t1.id}`)).body;
  r = await call('POST', '/api/runs', { task_id: t1.id, started_at: '2026-11-17T10:00:00+09:00', ended_at: '2026-11-17T11:10:00+09:00', blocked_reason: '무릎 통증' });
  assert.equal(r.status, 201); assert.equal(r.body.started_at, '2026-11-17T01:00:00.000Z'); assert.equal(r.body.ended_at, '2026-11-17T02:10:00.000Z'); assert.equal(r.body.actual_minutes, 70); assert.equal(r.body.blocked_reason, '무릎 통증');
  await call('POST', '/api/runs', { task_id: t2.id, started_at: '2026-11-18T01:00:00Z', ended_at: '2026-11-18T01:30:00Z', actual_minutes: 50 });
  await call('POST', '/api/runs', { task_id: t2.id, started_at: '2026-11-18T05:00:00Z', ended_at: '2026-11-18T05:10:00Z' });
  const planAfter = (await call('GET', `/api/plans/${plan.id}`)).body; const taskAfter = (await call('GET', `/api/tasks/${t1.id}`)).body;
  assert.deepEqual(planAfter, planBefore); assert.equal(taskAfter.title, taskBefore.title); assert.equal(taskAfter.estimated_minutes, taskBefore.estimated_minutes); assert.equal(taskAfter.due_date, taskBefore.due_date);
  assert.equal((await call('POST', '/api/runs', { task_id: t1.id, started_at: '2026-11-17T10:00:00Z', ended_at: '2026-11-17T09:00:00Z' })).status, 400);
  ok('C23-C27 실행 기록(시작·종료·소요·막힘), 원래 계획 값 불변');

  // C28-C32 retro
  ret = (await call('GET', '/api/retro')).body; const s = ret.summary;
  assert.equal(s.plans, 1); assert.equal(s.tasks, 5); assert.equal(s.done, 2); assert.equal(s.blocked, 1);
  assert.equal(s.estimated_minutes, 60 + 45 + 15 + 20 + 10); assert.equal(s.actual_minutes, 70 + 50 + 10); assert.equal(s.diff_minutes, 130 - 150);
  ok('C28-C32 회고 집계(계획 수·완료·막힘·예상/실제/차이)');
  await call('DELETE', `/api/tasks/${t5.id}`); ret = (await call('GET', '/api/retro')).body; assert.equal(ret.summary.tasks, 4); ok('C28 삭제된 할 일은 제외');
  assert.deepEqual(Object.values((await call('GET', '/api/retro?plan_id=999')).body.summary), [0, 0, 0, 0, 0, 0, 0, 0]); ok('C32 대상 없으면 0');
  // C83 evidence
  for (const m of ['plans', 'tasks', 'done', 'overdue', 'blocked', 'estimated_minutes', 'actual_minutes', 'diff_minutes']) {
    const e = (await call('GET', '/api/retro/evidence?metric=' + m)).body; assert.ok(e.rule && e.label, m);
    if (m === 'done') assert.equal(e.tasks.length, ret.summary.done);
    if (m === 'blocked') assert.equal(e.runs.length, 1);
    if (m === 'actual_minutes') assert.equal(e.runs.reduce((x, y) => x + y.actual_minutes, 0), ret.summary.actual_minutes);
    if (m === 'plans') assert.equal(e.plans.length, 1);
  }
  assert.equal((await call('GET', '/api/retro/evidence?metric=nope')).status, 400); ok('C83 집계 값 → 근거 기록 조회');
  // C33
  const plan2 = (await call('POST', '/api/plans', { title: '다음 주 운동', period_start: '2026-11-24', period_end: '2026-11-30', priority: 'medium', success_criteria: '주 3회', estimated_minutes: 300 })).body;
  const note = (await call('POST', '/api/retro/notes', { plan_id: plan.id, note: '예상 시간을 20% 늘려 잡기' })).body;
  r = await call('POST', `/api/retro/notes/${note.id}/apply`, { plan_id: plan2.id }); assert.equal(r.body.plan.improvement.note, '예상 시간을 20% 늘려 잡기'); assert.equal(r.body.note.applied_plan_id, plan2.id);
  const note2 = (await call('POST', '/api/retro/notes', { plan_id: plan.id, note: '두 번째' })).body; r = await call('POST', `/api/retro/notes/${note2.id}/apply`, {});
  assert.ok(r.body.plan.id !== plan.id && r.body.plan.period_start === '2026-11-24'); ok('C33 개선점 한 줄 → 다음 계획에 반영');

  // C34/C35 persistence across restart + export (C36)
  const exp1 = (await call('GET', '/api/export')).body; const tasksBefore = (await call('GET', '/api/tasks')).body.tasks;
  app.server.close(); app.db.close();
  app = createApp({ dbPath, today: () => FIXED_TODAY }); await new Promise((rr) => app.server.listen(0, rr));
  const tasksAfter = (await call('GET', '/api/tasks')).body.tasks; assert.deepEqual(tasksAfter, tasksBefore);
  const exp2 = (await call('GET', '/api/export')).body; delete exp1.exported_at; delete exp2.exported_at; assert.deepEqual(exp2, exp1);
  assert.equal(exp1.plans.length, 3); assert.ok(exp1.runs.length === 3 && exp1.completions.length === 2); ok('C34-C35 서버 재시작 후에도 ID·날짜·값·단위 동일');
  const raw = await fetch(base() + '/api/export'); assert.match(raw.headers.get('content-disposition'), /attachment/); ok('C36 파일 하나로 내보내기');

  // C57 literal script string + headers; C01 no auth
  const html = await (await fetch(base() + '/')).text(); assert.match(html, /지금은 로그인이 없어 링크를 아는 사람은 누구나 볼 수 있습니다\. 남이 봐도 괜찮은 내용만 넣으세요/); ok('C82 첫 화면 공개 범위 문구');
  const hr = await fetch(base() + '/'); assert.match(hr.headers.get('content-security-policy'), /script-src 'self'/); assert.equal(hr.status, 200); ok('C01 인증 없이 열림 + CSP');
  assert.equal((await fetch(base() + '/contracts/pds-schema-v2.json')).status, 200); assert.equal((await fetch(base() + '/..%2fserver.js')).status, 404); assert.equal((await fetch(base() + '/db.js')).status, 404); ok('정적 파일 경로 이탈 차단');

  app.server.close(); app.db.close(); fs.rmSync(dir, { recursive: true });
  console.log(`\nAll ${n} checks passed`);
})().catch((e) => { console.error(e); process.exit(1); });
