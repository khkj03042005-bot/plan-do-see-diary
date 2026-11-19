'use strict';
// 6번에서 로그인 없이 입력한 기록(주인 없음, user_id IS NULL)을 내 계정으로 이관한다. (T07-C100)
// 사용: DATABASE_URL=... node scripts/claim-legacy-data.js <내 아이디>
// - 먼저 웹 화면에서 가입해 계정을 만들어 둔다.
// - 한 트랜잭션으로 처리한다(중간에 실패하면 전부 되돌림). 이미 주인이 있는 행은 건드리지 않는다.
const { openDb } = require('../db');

(async () => {
  const username = String(process.argv[2] || '').trim().toLowerCase();
  if (!username) { console.error('사용법: node scripts/claim-legacy-data.js <내 아이디>'); process.exit(1); }
  const db = await openDb(process.env.DATABASE_URL);
  try {
    const u = await db.get('SELECT id FROM users WHERE username = ?', username);
    if (!u) throw new Error(`계정 '${username}' 이(가) 없습니다. 먼저 가입하세요.`);
    const tables = ['plans', 'plan_revisions', 'tasks', 'runs', 'completions', 'retro_notes'];
    const moved = {};
    await db.tx(async () => {
      for (const t of tables) moved[t] = (await db.run(`UPDATE ${t} SET user_id = ? WHERE user_id IS NULL`, u.id)).rowCount;
    });
    console.log(`계정 '${username}' 으로 이관 완료:`, moved);
  } catch (e) { console.error('실패(변경 없음):', e.message); process.exitCode = 1; }
  finally { await db.close(); }
})();
