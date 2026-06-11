const axios = require('axios');
const cheerio = require('cheerio');

async function parseXiaoyuzhou(url) {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 10000
    });

    const $ = cheerio.load(response.data);

    let title = $('title').text().trim();
    let description = $('meta[name="description"]').attr('content') || '';
    let image = $('meta[property="og:image"]').attr('content') || '';
    let audioUrl = $('meta[property="og:audio"]').attr('content') || 
                   $('meta[property="og:audio:url"]').attr('content') || '';

    if (!title) {
      title = $('h1').first().text().trim() || 'Unknown Podcast';
    }

    const twitterPlayer = $('meta[name="twitter:player"]').attr('content');
    if (!audioUrl && twitterPlayer) {
      audioUrl = twitterPlayer;
    }

    let fullText = '';
    let outline = [];
    
    const bodyText = $('body').text();
    if (bodyText && bodyText.length > 200) {
      fullText = bodyText.replace(/\s+/g, ' ').trim();
    }
    
    const timePattern = /(\d{2}:\d{2}:\d{2}|\d{2}:\d{2})\s*([^：:\n]+)/g;
    let match;
    while ((match = timePattern.exec(fullText)) !== null) {
      outline.push({
        timestamp: match[1],
        topic: match[2].trim()
      });
    }

    return {
      success: true,
      data: {
        title,
        description,
        image,
        audioUrl,
        originalUrl: url,
        fullText: fullText,
        outline: outline
      }
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '解析失败，请检查链接是否正确'
    };
  }
}

module.exports = { parseXiaoyuzhou };
