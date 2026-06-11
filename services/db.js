const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'app.db');

// 确保 data 目录存在
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// 建表
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    url TEXT NOT NULL,
    title TEXT DEFAULT '',
    description TEXT DEFAULT '',
    status TEXT DEFAULT 'processing',
    progress INTEGER DEFAULT 0,
    progress_label TEXT DEFAULT '',
    podcast_info TEXT DEFAULT '{}',
    transcription TEXT DEFAULT NULL,
    transcribe_source TEXT DEFAULT '',
    audio_duration REAL DEFAULT 0,
    dialogue TEXT DEFAULT NULL,
    summary TEXT DEFAULT '{}',
    note_url TEXT DEFAULT '',
    note_filename TEXT DEFAULT '',
    step_times TEXT DEFAULT '{}',
    elapsed_seconds INTEGER DEFAULT 0,
    error TEXT DEFAULT NULL,
    created_at TEXT DEFAULT (datetime('now','localtime')),
    completed_at TEXT DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );
`);

// 用户操作
function getOrCreateUser(username) {
  const existing = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (existing) return existing;
  db.prepare('INSERT INTO users (username) VALUES (?)').run(username);
  return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

function getUser(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

// 任务操作
function saveTask(task) {
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO tasks
      (id, user_id, url, title, description, status, progress, progress_label,
       podcast_info, transcription, transcribe_source, audio_duration,
       dialogue, summary, note_url, note_filename, step_times,
       elapsed_seconds, error, created_at, completed_at)
    VALUES
      (@id, @user_id, @url, @title, @description, @status, @progress, @progress_label,
       @podcast_info, @transcription, @transcribe_source, @audio_duration,
       @dialogue, @summary, @note_url, @note_filename, @step_times,
       @elapsed_seconds, @error, @created_at, @completed_at)
  `);
  stmt.run({
    id: task.id,
    user_id: task.user_id,
    url: task.url || '',
    title: (task.podcastInfo && task.podcastInfo.title) || '',
    description: task.summary ? (task.summary.coreSummary || '').substring(0, 200) : '',
    status: task.status || 'processing',
    progress: task.progress || 0,
    progress_label: task.progressLabel || '',
    podcast_info: JSON.stringify(task.podcastInfo || {}),
    transcription: task.transcription ? JSON.stringify(task.transcription) : null,
    transcribe_source: task.transcribeSource || '',
    audio_duration: task.audioDuration || 0,
    dialogue: task.dialogue || null,
    summary: task.summary ? JSON.stringify(task.summary) : '{}',
    note_url: task.noteUrl || '',
    note_filename: task.noteFilename || '',
    step_times: JSON.stringify(task.stepTimes || {}),
    elapsed_seconds: task.elapsedSeconds || 0,
    error: task.error || null,
    created_at: task.createdAt || new Date().toISOString(),
    completed_at: task.completedAt || null,
  });
}

function getTask(id) {
  const row = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
  return row ? rowToTask(row) : null;
}

function getUserTasks(userId) {
  const rows = db.prepare(
    'SELECT * FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT 50'
  ).all(userId);
  return rows.map(rowToTask);
}

function rowToTask(row) {
  return {
    id: row.id,
    user_id: row.user_id,
    url: row.url,
    status: row.status,
    progress: row.progress,
    progressLabel: row.progress_label,
    podcastInfo: safeJson(row.podcast_info),
    transcription: row.transcription ? safeJson(row.transcription) : null,
    transcribeSource: row.transcribe_source,
    audioDuration: row.audio_duration,
    dialogue: row.dialogue,
    summary: safeJson(row.summary),
    noteUrl: row.note_url,
    noteFilename: row.note_filename,
    stepTimes: safeJson(row.step_times),
    elapsedSeconds: row.elapsed_seconds,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    // 兼容旧前端字段
    podcastInfo_title: row.title,
    description: row.description,
  };
}

function safeJson(str) {
  try { return JSON.parse(str || '{}'); } catch { return {}; }
}

module.exports = { getOrCreateUser, getUser, saveTask, getTask, getUserTasks };
