const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { parseXiaoyuzhou } = require('../services/parser');
const { transcribeAudio } = require('../services/transcription');
const { generateSummary } = require('../services/summarizer');
const { saveNote } = require('../services/xiaohongshu');
const { formatDialogue } = require('../services/dialogue');
const { saveTask, getTask, getUserTasks } = require('../services/db');

const router = express.Router();

function uid(req) { return req.session.userId; }

router.post('/parse', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '请提供播客链接' });
  const result = await parseXiaoyuzhou(url);
  res.json(result);
});

router.post('/process', async (req, res) => {
  const { url, deepseekApiKey, deepseekApiBase } = req.body;
  if (!url) return res.status(400).json({ success: false, error: '请提供播客链接' });
  if (deepseekApiKey) process.env.DEEPSEEK_API_KEY = deepseekApiKey;
  if (deepseekApiBase) process.env.DEEPSEEK_API_BASE = deepseekApiBase;

  const taskId = uuidv4();
  const startedAt = Date.now();
  const abortController = new AbortController();
  const stepTimes = {};

  const task = {
    id: taskId,
    user_id: uid(req),
    url,
    status: 'processing',
    progress: 0,
    progressLabel: '准备中...',
    stepTimes,
    startedAt: new Date(startedAt).toISOString(),
    createdAt: new Date(startedAt).toISOString(),
    aborted: false,
    _abortController: abortController,
  };
  saveTask(task);
  res.json({ success: true, taskId, message: '任务已创建' });

  try {
    // Step 1: 解析 (0-10%)
    if (task.aborted) return;
    let stepStart = Date.now();
    task.progress = 5; task.progressLabel = '解析播客链接...';
    saveTask(task);

    const parseResult = await parseXiaoyuzhou(url);
    if (!parseResult.success) throw new Error(parseResult.error);
    stepTimes.parse = ((Date.now() - stepStart) / 1000).toFixed(1);

    if (task.aborted) return;
    task.podcastInfo = parseResult.data;
    task.progress = 10; task.progressLabel = '解析完成，准备转录...';
    saveTask(task);

    // Step 2: 转录 (10-55%)
    if (task.aborted) return;
    task.status = 'transcribing';
    task.progressLabel = '转录音频中...';
    saveTask(task);
    stepStart = Date.now();

    const progressCallback = (info) => {
      if (task.aborted) return;
      task.progress = 10 + Math.floor(info.percent * 0.45);
      task.progressLabel = info.detail || task.progressLabel;
      if (info.segments) task.liveSegments = info.segments;
      saveTask(task);
    };

    const transcribeResult = await transcribeAudio(
      parseResult.data.audioUrl, 'fast', progressCallback, abortController.signal
    );
    if (task.aborted) return;
    if (!transcribeResult.success) throw new Error(transcribeResult.error);

    task.transcription = transcribeResult.data;
    task.transcribeSource = transcribeResult.data.source;
    task.audioDuration = transcribeResult.data.duration || 0;
    stepTimes.transcribe = ((Date.now() - stepStart) / 1000).toFixed(1);

    // Step 2.5: 对话拆解
    task.progress = 55; task.progressLabel = '转录完成，拆解对话...';
    saveTask(task);
    stepStart = Date.now();

    const dialogueResult = await formatDialogue(transcribeResult.data.segments || [], abortController.signal);
    if (dialogueResult && dialogueResult.success) {
      task.dialogue = dialogueResult.dialogue;
    }
    stepTimes.dialogue = ((Date.now() - stepStart) / 1000).toFixed(1);

    // Step 3: AI 总结 (60-85%)
    if (task.aborted) return;
    task.status = 'summarizing';
    task.progress = 60; task.progressLabel = 'AI 总结中...';
    saveTask(task);
    stepStart = Date.now();

    const summaryResult = await generateSummary(transcribeResult.data.text, parseResult.data, abortController.signal);
    if (!summaryResult.success) throw new Error(summaryResult.error);
    stepTimes.summary = ((Date.now() - stepStart) / 1000).toFixed(1);

    if (task.aborted) return;
    task.summary = summaryResult.data;
    task.progress = 85; task.progressLabel = '生成小红书笔记...';
    saveTask(task);

    // Step 4: 笔记
    stepStart = Date.now();
    const noteResult = saveNote(task.summary, task.podcastInfo, task.transcription);
    if (noteResult.success) {
      task.noteUrl = noteResult.url;
      task.noteFilename = noteResult.filename;
    }
    stepTimes.note = ((Date.now() - stepStart) / 1000).toFixed(1);

    task.status = 'completed';
    task.progress = 100; task.progressLabel = '完成！';
    task.completedAt = new Date().toISOString();
    task.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    saveTask(task);
  } catch (error) {
    if (task.aborted) return;
    task.status = (error.name === 'AbortError') ? 'cancelled' : 'failed';
    task.error = task.status === 'cancelled' ? '用户取消' : error.message;
    task.progressLabel = task.status === 'cancelled' ? '已取消' : `失败: ${error.message}`;
    task.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    saveTask(task);
  }
});

// 取消
router.post('/cancel/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });
  if (['completed', 'failed', 'cancelled'].includes(task.status)) {
    return res.json({ success: false, error: '任务已结束' });
  }
  task.aborted = true;
  task.status = 'cancelled';
  task.error = '用户取消';
  task.progressLabel = '正在取消...';
  saveTask(task);
  res.json({ success: true, message: '已取消' });
});

// 重试
router.post('/retry/:id', async (req, res) => {
  const oldTask = getTask(req.params.id);
  if (!oldTask) return res.status(404).json({ success: false, error: '任务不存在' });

  const { deepseekApiKey, deepseekApiBase } = req.body;
  if (deepseekApiKey) process.env.DEEPSEEK_API_KEY = deepseekApiKey;
  if (deepseekApiBase) process.env.DEEPSEEK_API_BASE = deepseekApiBase;

  const taskId = uuidv4();
  const startedAt = Date.now();
  const abortController = new AbortController();
  const stepTimes = {};

  const task = {
    id: taskId,
    user_id: uid(req),
    url: oldTask.url,
    podcastInfo: oldTask.podcastInfo,
    status: 'transcribing',
    progress: 10,
    progressLabel: '重新转录中...',
    stepTimes,
    startedAt: new Date(startedAt).toISOString(),
    createdAt: new Date(startedAt).toISOString(),
    aborted: false,
    _abortController: abortController,
  };
  saveTask(task);
  res.json({ success: true, taskId, message: '已重新开始' });

  try {
    let stepStart = Date.now();
    const progressCallback = (info) => {
      if (task.aborted) return;
      task.progress = 10 + Math.floor(info.percent * 0.45);
      task.progressLabel = info.detail || task.progressLabel;
      if (info.segments) task.liveSegments = info.segments;
      saveTask(task);
    };

    const transcribeResult = await transcribeAudio(oldTask.url, 'fast', progressCallback, abortController.signal);
    if (task.aborted) return;
    if (!transcribeResult.success) throw new Error(transcribeResult.error);
    task.transcription = transcribeResult.data;
    task.transcribeSource = transcribeResult.data.source;
    task.audioDuration = transcribeResult.data.duration || 0;
    stepTimes.transcribe = ((Date.now() - stepStart) / 1000).toFixed(1);

    stepStart = Date.now();
    const dialogueResult = await formatDialogue(transcribeResult.data.segments || [], abortController.signal);
    if (dialogueResult && dialogueResult.success) task.dialogue = dialogueResult.dialogue;
    stepTimes.dialogue = ((Date.now() - stepStart) / 1000).toFixed(1);

    task.progress = 60; task.progressLabel = 'AI 总结中...';
    saveTask(task);
    stepStart = Date.now();

    const summaryResult = await generateSummary(transcribeResult.data.text, oldTask.podcastInfo || {}, abortController.signal);
    if (!summaryResult.success) throw new Error(summaryResult.error);
    stepTimes.summary = ((Date.now() - stepStart) / 1000).toFixed(1);

    task.summary = summaryResult.data;
    task.progress = 85; task.progressLabel = '生成笔记...';
    saveTask(task);

    stepStart = Date.now();
    const noteResult = saveNote(task.summary, oldTask.podcastInfo || {}, task.transcription);
    if (noteResult.success) {
      task.noteUrl = noteResult.url;
      task.noteFilename = noteResult.filename;
    }
    stepTimes.note = ((Date.now() - stepStart) / 1000).toFixed(1);

    task.status = 'completed';
    task.progress = 100; task.progressLabel = '完成！';
    task.completedAt = new Date().toISOString();
    task.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    saveTask(task);
  } catch (error) {
    if (task.aborted) return;
    task.status = (error.name === 'AbortError') ? 'cancelled' : 'failed';
    task.error = task.status === 'cancelled' ? '用户取消' : error.message;
    task.elapsedSeconds = Math.round((Date.now() - startedAt) / 1000);
    saveTask(task);
  }
});

// 查询
router.get('/task/:id', (req, res) => {
  const task = getTask(req.params.id);
  if (!task) return res.status(404).json({ success: false, error: '任务不存在' });

  const now = Date.now();
  const elapsed = task.startedAt
    ? Math.round((now - new Date(task.startedAt).getTime()) / 1000)
    : 0;
  let remainingSeconds = null;
  if (!['completed', 'failed', 'cancelled'].includes(task.status) && task.progress > 3 && task.progress < 100) {
    const total = (elapsed / task.progress) * 100;
    remainingSeconds = Math.max(0, Math.round(total - elapsed));
    if (remainingSeconds > 3600) remainingSeconds = null;
  }

  res.json({
    success: true,
    task: { ...task, _abortController: undefined, elapsedSeconds: elapsed, remainingSeconds, eta: remainingSeconds ? new Date(now + remainingSeconds * 1000).toISOString() : null },
  });
});

router.get('/tasks', (req, res) => {
  const tasks = getUserTasks(uid(req));
  res.json({ success: true, tasks });
});

module.exports = router;
