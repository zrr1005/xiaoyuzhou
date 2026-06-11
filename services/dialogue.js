const axios = require('axios');

async function formatDialogue(segments, signal = null) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.length < 10) return null;

  try {
    const apiBase = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1';

    // 第一步：按时间间隔和长度把碎片合并成自然段落
    const paragraphs = mergeIntoParagraphs(segments);

    if (paragraphs.length === 0) return null;
    console.log(`对话拆解: ${segments.length} 个碎片 → ${paragraphs.length} 个自然段落`);

    // 第二步：构建输入文本，每个段落一行
    const inputText = paragraphs
      .map(p => `[${p.time}] ${p.text}`)
      .join('\n\n');

    // 第三步：分块发给 DeepSeek 做说话人识别
    const chunks = chunkByCharLimit(inputText, 5000);
    let allDialogues = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const response = await axios.post(
        `${apiBase}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `你是一个播客对话整理专家。你的任务是把转录文字整理成清晰的对话格式。

核心要求：
1. 识别不同说话人。播客通常有"主持人"和"嘉宾"两个角色。如果无法确定就标为"A""B"
2. 将同一说话人的连续发言合并为一个完整段落。不要把一个人的话拆成多段
3. 保留每个段落的起始时间戳
4. 删除无意义的语气词（嗯、啊、对吧、就是说 等），但保留有信息量的内容
5. 一段对话中同一个人说的话应该完整呈现，哪怕原文跨了多个碎片

严格按以下格式输出（纯文本，不要markdown）：

主持人 [00:00]
完整段落内容，可以多句话。

嘉宾 [00:25]
完整段落内容。

主持人 [01:10]
...`,
            },
            { role: 'user', content: `请将以下转录整理为对话格式：

${chunk}

记住：同一说话人的连续内容合并为一个大段，不要拆碎。` },
          ],
          temperature: 0.2,
          max_tokens: 8192,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          timeout: 180000,
          signal,
        }
      );
      const text = response.data.choices?.[0]?.message?.content || '';
      if (text) allDialogues.push(text);
    }

    const dialogue = allDialogues.join('\n\n');
    console.log(`对话拆解完成，${dialogue.length} 字符`);
    return { success: true, dialogue, mergedSegments: paragraphs };
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'CanceledError') throw error;
    console.error('对话拆解失败:', error.message);
    return null;
  }
}

// 将碎片合并为自然段落：按停顿间隔(>2s)切分 + 最小段落长度(100字)
function mergeIntoParagraphs(segments) {
  if (!segments || segments.length === 0) return [];

  const paragraphs = [];
  let current = { ...segments[0] };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    // 计算当前片段的开始时间和上一个片段的结束时间之间的间隔
    const prevEnd = typeof current.end === 'number' ? current.end : (typeof current.start === 'number' ? current.start : 0);
    const segStart = typeof seg.start === 'number' ? seg.start : (typeof seg.end === 'number' ? seg.end : 0);
    const gap = segStart - prevEnd;

    // 停顿超过 2 秒 → 切新段
    // 或者当前段已经超过 300 字 → 切新段
    if (gap > 2.0 || current.text.length > 300) {
      paragraphs.push(current);
      current = { ...seg };
    } else {
      // 合并：追加文字，更新结束时间
      current.text += (current.text.endsWith('。') || current.text.endsWith('？') || current.text.endsWith('！') ? '' : '，') + seg.text;
      current.end = seg.end || seg.start;
    }
  }
  paragraphs.push(current);

  // 第二步：把过短的段落（<80字）合并到相邻段落
  return mergeShortParagraphs(paragraphs);
}

function mergeShortParagraphs(paragraphs) {
  if (paragraphs.length <= 1) return paragraphs;

  const result = [];
  let i = 0;

  while (i < paragraphs.length) {
    const p = paragraphs[i];

    // 如果当前段太短，尝试合并到下一段
    if (p.text.length < 80 && i + 1 < paragraphs.length) {
      paragraphs[i + 1].text = p.text + ' ' + paragraphs[i + 1].text;
      paragraphs[i + 1].time = p.time; // 保留较早的时间戳
      i++;
      continue;
    }

    // 如果当前段太短且是最后一段，合并到前一段
    if (p.text.length < 80 && result.length > 0) {
      result[result.length - 1].text += ' ' + p.text;
      i++;
      continue;
    }

    result.push(p);
    i++;
  }

  return result;
}

function chunkByCharLimit(text, maxLen) {
  const paragraphs = text.split('\n\n');
  const chunks = [];
  let current = '';

  for (const p of paragraphs) {
    if (current.length + p.length > maxLen) {
      chunks.push(current.trim());
      current = p;
    } else {
      current += (current ? '\n\n' : '') + p;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

module.exports = { formatDialogue };
