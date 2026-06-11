const axios = require('axios');

async function generateSummary(transcriptionText, podcastInfo, signal = null) {
  const apiKey = process.env.DEEPSEEK_API_KEY;

  if (!apiKey || apiKey === 'your-deepseek-api-key' || apiKey.length < 10) {
    return { success: false, error: '未配置 DeepSeek API Key' };
  }

  try {
    const apiBase = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com/v1';

    // 截取前 12000 字符避免超 token
    const text = transcriptionText.length > 12000
      ? transcriptionText.substring(0, 12000)
      : transcriptionText;

    const prompt = buildEditorPrompt(text, podcastInfo);

    const response = await axios.post(
      `${apiBase}/chat/completions`,
      {
        model: 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: prompt },
        ],
        temperature: 0.5,
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

    const text2 = response.data.choices?.[0]?.message?.content || '';
    console.log(`总结响应 ${text2.length} 字符`);

    return parseSummary(text2);
  } catch (error) {
    if (error.name === 'AbortError' || error.name === 'CanceledError') throw error;
    console.error('总结错误:', error.response?.data || error.message);
    return { success: false, error: `AI 总结失败: ${error.message}` };
  }
}

const SYSTEM_PROMPT = `你是一位资深播客主编。你不只是缩写内容，而是重新组织信息，让读者一眼看出这期节目的价值。

你必须返回严格 JSON 格式，字段说明：

- valueProposition: 一句话价值主张（这期对我有啥用？）
- keywords: 3-6 个核心关键词标签
- coreSummary: 核心摘要，200-400 字，信息密度高
- outline: 结构化二级大纲，每个主题包含时间戳、标题、3-5 个支撑论点
- qa: 启发式问答对，2-4 组，识别深层追问逻辑。每个含 question 和 answer
- mentalModels: 识别嘉宾的底层思维模式，1-3 个，每个含 name 和 insight
- keyConclusions: 关键金句，3-6 条，原话提炼
- actionItems: 行动清单，如推荐书籍、工具、方法论，每个含 name, type(book/tool/method), 和 reason
- externalLinks: 外部参考，如提及的人名、组织名，每个含 name 和 type(person/organization/term)`;

function buildEditorPrompt(text, podcastInfo) {
  return `请以资深主编身份分析以下播客内容。

播客标题: ${podcastInfo?.title || '未知'}

转录内容:
${text}

返回 JSON（严格 JSON，不要 markdown）:
{
  "valueProposition": "一句话说明这期节目的价值（对人有什么用）",
  "keywords": ["标签1", "标签2", "标签3"],
  "coreSummary": "200-400字高密度摘要，抓住核心观点和论证逻辑",
  "outline": [
    {
      "timestamp": "00:00",
      "title": "大主题",
      "points": ["支撑论点1", "支撑论点2", "支撑论点3"]
    }
  ],
  "qa": [
    { "question": "深层痛点问题", "answer": "嘉宾给出的独家解法或洞见" }
  ],
  "mentalModels": [
    { "name": "思维模式名称", "insight": "这个思维模式揭示了什么底层逻辑" }
  ],
  "keyConclusions": ["金句1", "金句2", "金句3"],
  "actionItems": [
    { "name": "推荐书名/工具名/方法论名", "type": "book/tool/method", "reason": "为什么推荐" }
  ],
  "externalLinks": [
    { "name": "人物名/组织名/术语", "type": "person/organization/term" }
  ]
}`;
}

function parseSummary(text) {
  let jsonStr = '';
  let m = text.match(/\{[\s\S]*\}/);
  if (m) {
    jsonStr = m[0];
  } else {
    m = text.match(/```json\n?([\s\S]*?)\n?```/);
    if (m) jsonStr = m[1];
    else throw new Error('未找到 JSON');
  }

  const summary = JSON.parse(jsonStr);

  // 确保所有字段存在
  return {
    success: true,
    data: {
      valueProposition: summary.valueProposition || '',
      keywords: summary.keywords || [],
      coreSummary: summary.coreSummary || '',
      outline: (summary.outline || []).map(o => ({
        timestamp: o.timestamp || '',
        title: o.title || '',
        points: o.points || [],
      })),
      qa: (summary.qa || []).map(q => ({
        question: q.question || '',
        answer: q.answer || '',
      })),
      mentalModels: (summary.mentalModels || []).map(m => ({
        name: m.name || '',
        insight: m.insight || '',
      })),
      keyConclusions: summary.keyConclusions || [],
      actionItems: (summary.actionItems || []).map(a => ({
        name: a.name || '',
        type: a.type || 'other',
        reason: a.reason || '',
      })),
      externalLinks: (summary.externalLinks || []).map(l => ({
        name: l.name || '',
        type: l.type || 'other',
      })),
    },
  };
}

module.exports = { generateSummary };
