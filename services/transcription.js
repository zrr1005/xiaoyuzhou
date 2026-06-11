const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { ensureReady, runTranscription } = require('./whisper-cpp');

async function downloadAudio(url, outputPath, onProgress, signal) {
  const writer = fs.createWriteStream(outputPath);
  const response = await axios({
    url,
    method: 'GET',
    responseType: 'stream',
    timeout: 300000,
    signal,
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });

  const totalLength = parseInt(response.headers['content-length'], 10) || 0;
  let downloaded = 0;

  return new Promise((resolve, reject) => {
    response.data.on('data', chunk => {
      downloaded += chunk.length;
      if (totalLength > 0 && onProgress) {
        const pct = Math.min(15, 5 + Math.floor((downloaded / totalLength) * 10));
        onProgress({ step: 'download', percent: pct, detail: `下载音频中... ${(downloaded / 1024 / 1024).toFixed(1)}MB` });
      }
    });
    response.data.pipe(writer);
    writer.on('finish', () => { writer.close(); resolve(); });
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

async function transcribeAudio(audioUrl, mode = 'fast', onProgress = null, signal = null) {
  const report = (step, percent, detail, segments) => {
    if (signal?.aborted) return;
    if (onProgress) onProgress({ step, percent, detail, segments });
  };

  report('init', 3, '初始化转录引擎...');
  if (signal?.aborted) return { success: false, error: '已取消' };

  // 确保 whisper.cpp 二进制和模型就绪
  try {
    await ensureReady();
  } catch (e) {
    return { success: false, error: `转录引擎初始化失败: ${e.message}` };
  }

  report('init', 5, '下载音频中...');

  // 1. 下载音频
  const tmpDir = os.tmpdir();
  const audioPath = path.join(tmpDir, `whisper_${Date.now()}.mp3`);

  try {
    await downloadAudio(audioUrl, audioPath, onProgress, signal);
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, error: '已取消' };
    return { success: false, error: `下载音频失败: ${e.message}` };
  }

  if (signal?.aborted) {
    try { fs.unlinkSync(audioPath); } catch {}
    return { success: false, error: '已取消' };
  }

  // 2. 转录
  report('transcribe', 18, '转录中...');

  const startTime = Date.now();
  let lastReportedPct = 0;

  try {
    const segments = await runTranscription(audioPath, {
      language: 'zh',
      beamSize: mode === 'accurate' ? 10 : 5,
      onProgress: (pct) => {
        // whisper.cpp 进度是 0-100%，映射到 18-90%
        const mappedPct = Math.floor(18 + (pct / 100) * 72);
        if (mappedPct > lastReportedPct + 2 || pct >= 100) {
          lastReportedPct = mappedPct;
          const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
          report('transcribe', Math.min(90, mappedPct), `转录中... ${elapsed}s`);
        }
      },
    });

    if (signal?.aborted) {
      try { fs.unlinkSync(audioPath); } catch {}
      return { success: false, error: '已取消' };
    }

    // 3. 格式化输出
    const formattedSegments = segments.map(seg => ({
      time: formatTime(seg.start),
      text: seg.text,
    }));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const fullText = formattedSegments.map(s => s.text).join(' ');
    const duration = formattedSegments.length > 0
      ? formattedSegments[formattedSegments.length - 1].time
      : '0:00';

    console.log(`转录完成: ${elapsed}s, ${formattedSegments.length} 段`);

    return {
      success: true,
      data: {
        text: fullText,
        segments: formattedSegments,
        duration,
        source: 'whisper-cpp-cpu',
      },
    };

  } catch (e) {
    return { success: false, error: `转录失败: ${e.message}` };
  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

module.exports = { transcribeAudio };
