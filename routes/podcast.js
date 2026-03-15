const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { parseXiaoyuzhou } = require('../services/parser');
const { transcribeAudio } = require('../services/transcription');
const { generateSummary } = require('../services/summarizer');
const { pushToFeishu, pushToFeishuBitable } = require('../services/feishu');

const router = express.Router();

const tasks = new Map();

router.post('/parse', async (req, res) => {
  const { url } = req.body;
  
  if (!url) {
    return res.status(400).json({ success: false, error: '请提供播客链接' });
  }

  const result = await parseXiaoyuzhou(url);
  res.json(result);
});

router.post('/process', async (req, res) => {
  const { url, mode = 'fast', openaiApiKey, openaiProxy, geminiApiKey, geminiProxy, localProxy, feishuAppId, feishuAppSecret, feishuBitableToken } = req.body;
  
  if (!url) {
    return res.status(400).json({ success: false, error: '请提供播客链接' });
  }

  if (openaiApiKey) {
    process.env.OPENAI_API_KEY = openaiApiKey;
  }
  if (openaiProxy) {
    process.env.OPENAI_API_BASE = openaiProxy;
  }
  if (geminiApiKey) {
    process.env.GEMINI_API_KEY = geminiApiKey;
  }
  if (geminiProxy) {
    process.env.GEMINI_API_BASE = geminiProxy;
  }
  if (localProxy) {
    process.env.HTTPS_PROXY = localProxy;
    process.env.HTTP_PROXY = localProxy;
    console.log('本地代理已设置:', localProxy);
  }

  const feishuEnabled = feishuAppId && feishuAppSecret && feishuBitableToken;

  const taskId = uuidv4();
  const task = {
    id: taskId,
    url,
    status: 'processing',
    feishuEnabled,
    feishuAppId,
    feishuAppSecret,
    feishuBitableToken,
    progress: 0,
    createdAt: new Date().toISOString()
  };
  
  tasks.set(taskId, task);

  res.json({ success: true, taskId, message: '任务已创建' });

  try {
    task.progress = 10;
    task.status = 'parsing';
    tasks.set(taskId, task);

    const parseResult = await parseXiaoyuzhou(url);
    if (!parseResult.success) {
      throw new Error(parseResult.error);
    }

    task.podcastInfo = parseResult.data;
    task.progress = 20;
    tasks.set(taskId, task);

    task.status = 'transcribing';
    const transcribeResult = await transcribeAudio(parseResult.data.audioUrl, mode);
    if (!transcribeResult.success) {
      throw new Error(transcribeResult.error);
    }

    task.transcription = transcribeResult.data;
    task.progress = 50;
    tasks.set(taskId, task);

    task.status = 'summarizing';
    const summaryResult = await generateSummary(transcribeResult.data.text, parseResult.data);
    if (!summaryResult.success) {
      throw new Error(summaryResult.error);
    }

    task.summary = summaryResult.data;
    task.progress = 80;
    tasks.set(taskId, task);

    if (task.feishuEnabled) {
      try {
        task.status = 'syncing';
        tasks.set(taskId, task);
        
        const feishuResult = await pushToFeishuBitable(
          task.feishuAppId,
          task.feishuAppSecret,
          task.feishuBitableToken,
          {
            title: task.podcastInfo?.title,
            originalUrl: task.url,
            summary: task.summary,
            transcriptionLength: task.transcription?.length || 0
          }
        );
        
        if (feishuResult.success) {
          task.feishuSynced = true;
          task.feishuRecordId = feishuResult.data?.recordId;
        } else {
          task.feishuError = feishuResult.error;
        }
      } catch (feishuError) {
        task.feishuError = feishuError.message;
      }
    }

    task.status = 'completed';
    task.progress = 100;
    task.completedAt = new Date().toISOString();
    tasks.set(taskId, task);

  } catch (error) {
    task.status = 'failed';
    task.error = error.message;
    tasks.set(taskId, task);
  }
});

router.get('/task/:id', (req, res) => {
  const { id } = req.params;
  const task = tasks.get(id);
  
  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  
  res.json({ success: true, task });
});

router.get('/tasks', (req, res) => {
  const taskList = Array.from(tasks.values()).reverse();
  res.json({ success: true, tasks: taskList });
});

router.post('/push-feishu-bitable', async (req, res) => {
  const { taskId, feishuAppId, feishuAppSecret, feishuBitableToken } = req.body;
  
  if (!taskId || !feishuAppId || !feishuAppSecret || !feishuBitableToken) {
    return res.status(400).json({ success: false, error: '缺少飞书配置参数' });
  }
  
  const task = tasks.get(taskId);
  if (!task) {
    return res.status(404).json({ success: false, error: '任务不存在' });
  }
  
  if (task.status !== 'completed') {
    return res.status(400).json({ success: false, error: '任务尚未完成' });
  }
  
  const result = await pushToFeishuBitable(feishuAppId, feishuAppSecret, feishuBitableToken, {
    title: task.podcastInfo?.title,
    originalUrl: task.url,
    summary: task.summary,
    transcriptionLength: task.transcription?.length || 0
  });
  
  if (result.success) {
    task.feishuSynced = true;
    task.feishuRecordId = result.data?.recordId;
    tasks.set(taskId, task);
  }
  
  res.json(result);
});

module.exports = router;
