const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

let cachedToken = null;
let tokenExpireTime = 0;

async function getFeishuAccessToken(appId, appSecret) {
  if (cachedToken && Date.now() < tokenExpireTime) {
    return cachedToken;
  }

  const response = await axios.post(
    'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    {
      app_id: appId,
      app_secret: appSecret
    },
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );

  if (response.data.code === 0) {
    cachedToken = response.data.tenant_access_token;
    tokenExpireTime = Date.now() + (response.data.expire - 60) * 1000;
    return cachedToken;
  }

  throw new Error(`飞书认证失败: ${response.data.msg}`);
}

async function pushToFeishuBitable(appId, appSecret, appToken, data) {
  try {
    const accessToken = await getFeishuAccessToken(appId, appSecret);
    const baseUrl = 'https://open.feishu.cn/open-apis';

    let baseId = appToken;
    let tableId = 'default';
    
    if (appToken.includes('base/') || appToken.includes('bitable/') || appToken.includes('?')) {
      const match = appToken.match(/(?:base|bitable)\/([^\?]+)/);
      if (match) {
        baseId = match[1].split('?')[0];
      }
      const tableMatch = appToken.match(/table=([^&]+)/);
      if (tableMatch) {
        tableId = decodeURIComponent(tableMatch[1]);
      }
      const tableIdMatch = appToken.match(/tableId=([^&]+)/);
      if (tableIdMatch) {
        tableId = decodeURIComponent(tableIdMatch[1]);
      }
    }
    
    console.log('解析后的 Base ID:', baseId, 'Table ID:', tableId);
    console.log('App Token 原始值:', appToken);

    const fields = {};
    if (data.title) fields['标题'] = data.title;
    if (data.summary?.coreSummary) fields['摘要'] = data.summary.coreSummary;
    if (data.summary?.keyConclusions?.length) fields['金句'] = data.summary.keyConclusions.join('\n');
    if (data.transcriptionLength) fields['原文字数'] = data.transcriptionLength;
    if (data.originalUrl) fields['小宇宙链接'] = data.originalUrl;
    
    const markdownContent = buildMarkdownContent(data);
    if (markdownContent) fields['总结内容'] = markdownContent;
    fields['状态'] = '✅ 已同步飞书';
    fields['同步时间'] = new Date().toISOString();

    console.log('飞书请求字段:', JSON.stringify(fields, null, 2));

    const records = [{ fields: fields }];
    const requestBody = { records };
    
    console.log('飞书请求体:', JSON.stringify(requestBody, null, 2));
    console.log('请求URL:', `${baseUrl}/bitable/v1/apps/${baseId}/tables/${tableId}/records`);

    const response = await axios.post(
      `${baseUrl}/bitable/v1/apps/${baseId}/tables/${tableId}/records`,
      requestBody,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    console.log('飞书响应:', JSON.stringify(response.data, null, 2));

    if (response.data.code === 0) {
      return {
        success: true,
        message: '已同步到飞书多维表格',
        data: {
          recordId: response.data.data?.record?.record_id
        }
      };
    }

    throw new Error(response.data.msg || '同步失败');
  } catch (error) {
    const errorData = error.response?.data;
    console.error('飞书多维表格同步错误:', errorData || error.message);
    
    if (errorData?.error?.field_violations) {
      console.error('字段验证错误详情:', JSON.stringify(errorData.error.field_violations, null, 2));
    }
    
    return {
      success: false,
      error: errorData?.msg || error.message || '飞书同步失败',
      details: errorData?.error?.field_violations || []
    };
  }
}

function buildMarkdownContent(data) {
  let md = `# ${data.title || '播客总结'}\n\n`;
  md += `**来源**: ${data.originalUrl || ''}\n\n`;
  
  if (data.summary?.coreSummary) {
    md += `## 📝 核心摘要\n\n${data.summary.coreSummary}\n\n`;
  }
  
  if (data.summary?.outline?.length) {
    md += `## 📋 结构化大纲\n\n`;
    data.summary.outline.forEach(item => {
      md += `- **${item.timestamp}** ${item.topic}\n`;
    });
    md += '\n';
  }
  
  if (data.summary?.keyConclusions?.length) {
    md += `## 🎯 关键结论\n\n`;
    data.summary.keyConclusions.forEach(item => {
      md += `- ${item}\n`;
    });
    md += '\n';
  }
  
  if (data.summary?.externalLinks?.length) {
    md += `## 📚 延伸阅读\n\n`;
    data.summary.externalLinks.forEach(link => {
      md += `- ${link.name} (${link.type})\n`;
    });
  }
  
  return md;
}

async function pushToFeishu(folderToken, data) {
  try {
    const feishuApiUrl = `https://open.feishu.cn/open-apis/bitable/v1/apps/${bitableToken}/tables`;

    const recordData = {
      fields: {
        '标题': data.title || '',
        '摘要': data.summary?.coreSummary || '',
        '播客链接': data.originalUrl || '',
        '总结': JSON.stringify(data.summary?.keyConclusions || []),
        '外部链接': JSON.stringify(data.summary?.externalLinks || []),
        '状态': '已完成',
        '创建时间': new Date().toISOString()
      }
    };

    return {
      success: true,
      message: '数据已准备好推送到飞书多维表格',
      data: recordData
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '飞书推送失败'
    };
  }
}

module.exports = { pushToFeishu, pushToFeishuBitable };
