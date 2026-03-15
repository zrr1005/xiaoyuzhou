const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const { HttpsProxyAgent } = require('https-proxy-agent');

async function transcribeAudio(audioUrl, mode = 'fast') {
  try {
    const apiKey = process.env.OPENAI_API_KEY;
    const apiBase = process.env.OPENAI_API_BASE || 'https://api.openai.com/v1';
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy;
    
    console.log('OpenAI API Base:', apiBase);
    console.log('Proxy:', proxyUrl || 'no proxy');

    let agent = null;
    if (proxyUrl) {
      agent = new HttpsProxyAgent(proxyUrl);
      console.log('使用 https-proxy-agent 连接代理');
    }

    let audioBuffer;
    
    if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
      const audioResponse = await axios.get(audioUrl, { 
        responseType: 'arraybuffer',
        timeout: 120000,
        ...(agent && { agent })
      });
      audioBuffer = Buffer.from(audioResponse.data);
    } else {
      audioBuffer = fs.readFileSync(audioUrl);
    }

    if (!apiKey || apiKey === 'your-openai-api-key' || apiKey.length < 10) {
      console.log('未配置 OpenAI API Key，使用模拟转录数据');
      return getMockTranscription();
    }

    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'audio.mp3' });
    form.append('model', 'whisper-1');
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities', ['segment']);
    if (mode === 'fast') {
      form.append('language', 'zh');
    }

    const response = await axios.post(
      `${apiBase}/audio/transcriptions`,
      form,
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...form.getHeaders()
        },
        timeout: 300000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        ...(agent && { agent })
      }
    );

    const segments = response.data.segments.map(seg => ({
      time: formatTime(seg.start),
      text: seg.text.trim()
    }));

    return {
      success: true,
      data: {
        text: response.data.text,
        segments: segments,
        duration: response.data.duration
      }
    };
  } catch (error) {
    console.error('转录错误:', error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data?.error?.message || error.message || '转录失败'
    };
  }
}

function getMockTranscription() {
  return {
    success: true,
    data: {
      text: "欢迎来到本期播客节目，今天我们要讨论人工智能对未来工作和生活的影响。首先让我们了解一下目前AI技术的发展现状。根据最新的研究报告显示，AI技术正在快速改变各个行业的格局。很多人担心AI会取代人类的工作，但实际上它更多是帮助我们提高效率。AI在医疗、教育、金融等领域都有广泛应用。总结一下，AI不是要取代人类，而是增强人类的能力。",
      segments: [
        { time: '00:00', text: '欢迎来到本期播客节目' },
        { time: '00:15', text: '今天我们要讨论的话题是关于人工智能对未来工作的影响' },
        { time: '00:45', text: '首先让我们了解一下目前AI技术的发展现状' },
        { time: '01:20', text: '根据最新的研究报告显示，AI技术正在快速改变各个行业的格局' },
        { time: '02:00', text: '很多人担心AI会取代人类的工作，但实际上它更多是帮助我们提高效率' },
        { time: '02:30', text: 'AI在内容创作、数据分析、客户服务等领域都能发挥重要作用' },
        { time: '03:15', text: '当然，我们也需要关注AI带来的伦理问题和监管挑战' },
        { time: '04:00', text: '接下来让我们深入探讨几个具体的应用场景' },
        { time: '04:45', text: '第一个场景是医疗健康领域，AI可以帮助医生进行诊断' },
        { time: '05:30', text: '第二个场景是教育培训，个性化学习将变得更加普遍' },
        { time: '06:15', text: '第三个场景是金融领域，风险评估和欺诈检测更加精准' },
        { time: '07:00', text: '总结一下，AI不是要取代人类，而是增强人类的能力' },
        { time: '07:30', text: '我们需要学会与AI协作，这将是一个重要的职业技能' }
      ],
      duration: 480
    }
  };
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

module.exports = { transcribeAudio };
