require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const podcastRoutes = require('./routes/podcast');
const { getOrCreateUser, getUser } = require('./services/db');

// 日志
const logStream = fs.createWriteStream(path.join(__dirname, 'app.log'), { flags: 'a' });
const originalLog = console.log;
const originalError = console.error;
console.log = function (...args) {
  const msg = `[${new Date().toLocaleString()}] LOG: ${args.join(' ')}\n`;
  logStream.write(msg);
  originalLog.apply(console, args);
};
console.error = function (...args) {
  const msg = `[${new Date().toLocaleString()}] ERROR: ${args.join(' ')}\n`;
  logStream.write(msg);
  originalError.apply(console, args);
};

const app = express();
const PORT = process.env.PORT || 3001;

// Session
app.use(session({
  secret: 'xiaoyuzhou-assistant-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }, // 30 天
}));

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// 登录检查中间件
function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ success: false, error: '请先登录', needLogin: true });
  }
  next();
}

// API 路由（需要登录）
app.use('/api/podcast', requireLogin, podcastRoutes);

// 用户 API
app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (!username || !username.trim()) {
    return res.status(400).json({ success: false, error: '请输入用户名' });
  }
  const name = username.trim();
  if (name.length > 30) {
    return res.status(400).json({ success: false, error: '用户名过长' });
  }
  const user = getOrCreateUser(name);
  req.session.userId = user.id;
  req.session.username = user.username;
  res.json({ success: true, user: { id: user.id, username: user.username } });
});

app.get('/api/me', (req, res) => {
  if (!req.session.userId) {
    return res.json({ success: false, needLogin: true });
  }
  const user = getUser(req.session.userId);
  res.json({ success: true, user: user ? { id: user.id, username: user.username } : null });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

// 页面路由
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'index.html'));
});
app.get('/task/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'task.html'));
});
app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'views', 'settings.html'));
});

app.listen(PORT, () => {
  console.log(`小宇宙总结助手 server running on http://localhost:${PORT}`);
  console.log(`转录引擎: whisper.cpp (CPU)`);
});
