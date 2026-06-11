const axios = require('axios');

const WHISPER_SERVER_URL = process.env.WHISPER_SERVER_URL || 'http://127.0.0.1:5001';

async function transcribeAudio(audioUrl, mode = 'fast', onProgress = null, signal = null) {
  const report = (step, percent, detail, segments) => {
    if (signal?.aborted) return;
    if (onProgress) onProgress({ step, percent, detail, segments });
  };

  // 检查服务就绪
  try {
    const health = await axios.get(`${WHISPER_SERVER_URL}/health`, { timeout: 3000 });
    if (health.data.status !== 'ready') {
      return { success: false, error: `Whisper 服务未就绪 (${health.data.status})` };
    }
  } catch (e) {
    return { success: false, error: '本地 Whisper 服务未启动' };
  }

  report('local', 5, '提交转录任务...');

  // 提交转录任务
  let jobId;
  try {
    const res = await axios.post(
      `${WHISPER_SERVER_URL}/transcribe`,
      { url: audioUrl, language: 'zh', beam_size: mode === 'accurate' ? 10 : 5, vad_filter: false },
      { timeout: 30000, signal }
    );
    if (!res.data.success) {
      return { success: false, error: res.data.error };
    }
    jobId = res.data.job_id;
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return { success: false, error: `提交转录失败: ${e.message}` };
  }

  report('local', 8, '正在下载音频并转录...');

  // 轮询进度（最多等 30 分钟）
  const startTime = Date.now();
  const MAX_WAIT = 30 * 60 * 1000;
  let lastSegmentCount = 0;

  while (true) {
    if (Date.now() - startTime > MAX_WAIT) {
      return { success: false, error: '转录超时（超过 30 分钟）' };
    }
    if (signal?.aborted) {
      return { success: false, error: '已取消' };
    }

    try {
      const pollRes = await axios.get(
        `${WHISPER_SERVER_URL}/transcribe/progress/${jobId}`,
        { timeout: 5000 }
      );
      const job = pollRes.data;

      if (!job.success) {
        console.log('进度查询返回错误:', job.error);
        await sleep(2000);
        continue; // 不要 break，继续重试
      }

      if (job.status === 'error') {
        return { success: false, error: job.error || '转录失败' };
      }

      if (job.status === 'done') {
        const segments = job.segments.map(seg => ({
          time: formatTime(seg.start),
          text: seg.text,
        }));
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
        console.log(`转录完成: ${elapsed}s, ${segments.length} 段`);

        return {
          success: true,
          data: {
            text: job.full_text,
            segments,
            duration: job.duration,
            source: 'local-whisper',
          },
        };
      }

      // 实时进度：有新增段落时回调
      const currentCount = job.segment_count || 0;
      if (currentCount > lastSegmentCount) {
        lastSegmentCount = currentCount;
        const recentSegments = (job.segments || []).slice(-30).map(seg => ({
          time: formatTime(seg.start),
          text: seg.text,
        }));
        const elapsed = job.elapsed || ((Date.now() - startTime) / 1000);
        const pct = Math.min(90, 10 + Math.floor((elapsed / 1200) * 80)); // 粗糙估算
        report('local', pct, `转录中... ${currentCount} 段`, recentSegments);
      }

    } catch (e) {
      // 轮询失败，继续重试
      console.log('轮询重试:', e.message);
    }

    await sleep(1500);
  }

  return { success: false, error: '转录超时或失败' };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

module.exports = { transcribeAudio };
