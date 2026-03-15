require('dotenv').config();
const express = require('express');
const path = require('path');
const podcastRoutes = require('./routes/podcast');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/podcast', podcastRoutes);

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
});
