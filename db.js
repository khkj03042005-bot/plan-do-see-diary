'use strict';
const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(`
  -- 날짜 규칙: 기간/마감일은 'YYYY-MM-DD'(Asia/Seoul 달력 날짜), 시각은 ISO-8601 UTC('...Z'). 시간 단위는 모두 '분'.
  CREATE TABLE IF NOT EXISTS plans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
    success_criteria TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
    improvement_note_id INTEGER,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  -- 계획 수정 이력: revision_no 0 = 최초 계획(생성 시점 그대로), 1.. = 수정 후 값. plans 는 '현재 값'만 보관.
  CREATE TABLE IF NOT EXISTS plan_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    revision_no INTEGER NOT NULL,
    title TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    priority TEXT NOT NULL,
    success_criteria TEXT NOT NULL,
    estimated_minutes INTEGER NOT NULL,
    revised_at TEXT NOT NULL,
    UNIQUE (plan_id, revision_no)
  );
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
    due_date TEXT,
    priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
    estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS task_tags (
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (task_id, tag)
  );
  -- 실행 기록: 계획/할 일과 별도 테이블. 저장해도 plans/tasks 값은 바뀌지 않는다.
  CREATE TABLE IF NOT EXISTS runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    actual_minutes INTEGER NOT NULL CHECK (actual_minutes >= 0),
    blocked_reason TEXT,
    created_at TEXT NOT NULL
  );
  -- 완료 기록: 할 일당 1건(UNIQUE task_id) + 멱등성 키 UNIQUE. 버튼 비활성화가 아니라 DB 제약으로 중복 방지.
  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL UNIQUE,
    completed_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS retro_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id INTEGER NOT NULL REFERENCES plans(id) ON DELETE CASCADE,
    note TEXT NOT NULL,
    applied_plan_id INTEGER REFERENCES plans(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id);
  CREATE INDEX IF NOT EXISTS idx_runs_task ON runs(task_id);
  `);
  return db;
}
module.exports = { openDb };
