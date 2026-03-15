const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');

async function generateSummary(transcriptionText, podcastInfo) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    let apiBase = process.env.GEMINI_API_BASE || 'https://generativelanguage.googleapis.com/v1beta';
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
    
    console.log('Gemini API Key:', apiKey ? apiKey.substring(0, 10) + '...' : 'empty');
    console.log('Gemini API Base:', apiBase);
    console.log('Proxy:', proxyUrl || 'no proxy');
    
    let agent = null;
    if (proxyUrl) {
      agent = new HttpsProxyAgent(proxyUrl);
      console.log('使用 https-proxy-agent 连接代理');
    }
    
    if (!apiKey || apiKey === 'your-gemini-api-key' || apiKey.length < 10) {
      throw new Error('请在环境变量中配置 GEMINI_API_KEY');
    }

    if (apiBase.includes('.googleapis.com') && !apiBase.includes(':generateContent')) {
      apiBase = `${apiBase}/models/gemini-2.5-flash:generateContent`;
    }

    const prompt = `请分析以下播客内容，并按要求生成结构化总结：

播客标题: ${podcastInfo?.title || '未知'}
音频链接: ${podcastInfo?.originalUrl || '未知'}

转录内容:
${transcriptionText}

请按以下JSON格式返回总结（只需返回JSON，不要其他内容）:
{
  "coreSummary": "核心摘要，300字以内，概括主要内容",
  "outline": [
    {"timestamp": "时间戳如 00:00", "topic": "话题标题"}
  ],
  "keyConclusions": [
    "关键结论1",
    "关键结论2",
    "关键结论3"
  ],
  "externalLinks": [
    {"name": "名称", "type": "book/person/organization/software"}
  ]
}`;

    let requestUrl = apiBase;
    console.log('Request URL before:', requestUrl);
    
    if (requestUrl.includes(':generateContent')) {
      console.log('使用完整的代理URL，保留原始路径');
    } else if (requestUrl.includes('generativelanguage.googleapis.com')) {
      requestUrl = `${requestUrl}/models/gemini-2.5-flash:generateContent`;
    } else if (!requestUrl.includes('/models/')) {
      requestUrl = `${requestUrl}/v1beta/models/gemini-2.5-flash:generateContent`;
    }
    console.log('Request URL after:', requestUrl);

    let fullUrl;
    if (requestUrl.includes('?key=')) {
      fullUrl = requestUrl;
    } else {
      fullUrl = `${requestUrl}?key=${apiKey}`;
    }
    console.log('Full URL:', fullUrl);
    console.log('API Key:', apiKey ? apiKey.substring(0, 15) + '...' : 'empty');
    
    const response = await axios.post(
      fullUrl,
      {
        contents: [{
          parts: [{
            text: prompt
          }]
        }],
        generationConfig: {
          temperature: 0.7,
          maxOutputTokens: 2048,
          topP: 0.95,
          topK: 40
        }
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        timeout: 60000,
        ...(agent && { agent })
      }
    );

    console.log('Gemini Response:', JSON.stringify(response.data).substring(0, 500));

    const responseText = response.data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('AI返回格式解析失败');
    }

    const summary = JSON.parse(jsonMatch[0]);

    return {
      success: true,
      data: summary
    };
  } catch (error) {
    let errorMsg = 'AI总结生成失败';
    
    if (error.response) {
      console.error('AI总结错误 - Status:', error.response.status);
      console.error('AI总结错误 - Data:', JSON.stringify(error.response.data).substring(0, 500));
      errorMsg = error.response.data?.error?.message || error.response.data?.error?.description || `HTTP ${error.response.status}: AI总结生成失败`;
    } else if (error.request) {
      console.error('AI总结错误 - No response received');
      console.error('AI总结错误 - Request:', error.request);
      errorMsg = '无法连接到Gemini API，请检查网络或代理设置';
    } else {
      console.error('AI总结错误 - Message:', error.message);
      console.error('AI总结错误 - Stack:', error.stack);
      errorMsg = error.message || 'AI总结生成失败';
    }
    
    return {
      success: false,
      error: errorMsg
    };
  }
}

module.exports = { generateSummary };
