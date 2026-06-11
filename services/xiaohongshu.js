const fs = require('fs');
const path = require('path');

function generateNote(summary, podcastInfo, transcription) {
  const title = podcastInfo?.title || '播客笔记';
  const valueProposition = summary?.valueProposition || '';
  const keywords = summary?.keywords || [];
  const coreSummary = summary?.coreSummary || '';
  const outline = summary?.outline || [];
  const qa = summary?.qa || [];
  const mentalModels = summary?.mentalModels || [];
  const keyConclusions = summary?.keyConclusions || [];
  const actionItems = summary?.actionItems || [];
  const segments = transcription?.segments || [];
  const source = transcription?.source || '';
  const duration = transcription?.duration || 0;

  const durationStr = duration > 0
    ? `${Math.floor(duration / 60)}分${Math.floor(duration % 60)}秒`
    : '';

  const now = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)} - 小宇宙笔记</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.7.0/style.css" />
<link href="https://fonts.googleapis.com/css2?family=ZCOOL+KuaiLe&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
<script>mermaid.initialize({startOnLoad:true, theme:'base', securityLevel:'loose'});</script>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #f5f0e8;
    background-image:
      repeating-linear-gradient(#e8e0d0 0px, #e8e0d0 1px, transparent 1px, transparent 32px),
      repeating-linear-gradient(90deg, #e8e0d0 0px, #e8e0d0 1px, transparent 1px, transparent 100%);
    font-family: 'LXGW WenKai', 'Long Cang', cursive, sans-serif;
    display: flex;
    justify-content: center;
    padding: 40px 20px;
    line-height: 1.8;
  }
  .notebook {
    max-width: 750px;
    width: 100%;
    background: #fffef9;
    padding: 50px 40px;
    box-shadow: 2px 3px 12px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04);
    border-radius: 4px;
    border-left: 3px solid #f0c0c0;
    position: relative;
  }
  h1 {
    font-family: 'ZCOOL KuaiLe', 'Ma Shan Zheng', cursive;
    font-size: 2em;
    color: #2c2c2c;
    margin-bottom: 8px;
    line-height: 1.5;
    background: linear-gradient(transparent 60%, #ffe066 60%);
    display: inline;
    padding: 0 6px;
  }
  h2 {
    font-family: 'ZCOOL KuaiLe', cursive;
    font-size: 1.3em;
    margin: 28px 0 12px;
    color: #555;
    border-bottom: 2px dashed #e8e0d0;
    padding-bottom: 6px;
  }
  .meta-line {
    font-size: 0.9em;
    color: #aaa;
    margin: 8px 0 20px;
  }
  .highlight {
    background: linear-gradient(120deg, #fff9c4 0%, #fff176 100%);
    border-left: 4px solid #f9a825;
    padding: 14px 18px;
    margin: 20px 0;
    border-radius: 0 8px 8px 0;
    font-size: 1.05em;
    position: relative;
    line-height: 1.9;
  }
  .highlight::before { content: '📌'; position: absolute; top: -10px; left: 8px; font-size: 1.2em; }
  ul { list-style: none; padding-left: 0; }
  ul li { padding: 6px 0 6px 28px; position: relative; }
  ul li::before { content: '✦'; position: absolute; left: 4px; color: #f0a0a0; }
  mark {
    background: linear-gradient(transparent 55%, #ffe066 55%);
    padding: 0 2px;
  }
  .pink-mark {
    background: linear-gradient(transparent 55%, #ffcdd2 55%);
    padding: 0 2px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 20px 0;
    font-size: 0.95em;
  }
  th {
    background: #f5f0e8;
    border-bottom: 2px solid #d0c8b8;
    padding: 10px 12px;
    text-align: left;
    font-weight: bold;
  }
  td { border-bottom: 1px dashed #d8d0c0; padding: 10px 12px; }
  .tags {
    margin-top: 30px;
    padding-top: 20px;
    border-top: 2px dashed #e0d8c8;
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
  }
  .tag {
    background: #f5f0e8;
    color: #8d6e63;
    padding: 4px 14px;
    border-radius: 20px;
    font-size: 0.9em;
    border: 1px solid #e0d8c8;
  }
  .qa-card {
    background: #fafaf5;
    border-radius: 10px;
    padding: 16px 20px;
    margin: 14px 0;
    border: 1px solid #e8e0d0;
  }
  .qa-card .q {
    font-weight: 700;
    color: #e17055;
    margin-bottom: 6px;
  }
  .qa-card .a { color: #555; line-height: 1.9; }
  .mental-card {
    padding: 12px 0;
    border-bottom: 1px dotted #e0d8c8;
  }
  .mental-card:last-child { border-bottom: none; }
  .mental-card .name { font-weight: 700; font-size: 1.05em; }
  .mental-card .insight { color: #777; font-size: 0.95em; margin-top: 4px; }
  .action-row {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 8px 0;
    border-bottom: 1px dotted #e0d8c8;
  }
  .action-row:last-child { border-bottom: none; }
  .action-badge {
    flex-shrink: 0;
    padding: 3px 10px;
    border-radius: 14px;
    font-size: 0.8em;
    font-weight: 600;
    background: #e8f5e9;
    color: #2e7d32;
  }
  .action-reason { color: #888; font-size: 0.9em; }
  .outline-block {
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px dotted #e8e0d0;
  }
  .outline-block:last-child { border-bottom: none; }
  .outline-time {
    font-size: 0.8em;
    color: #e17055;
    font-weight: 600;
    display: inline-block;
    background: #fff0ed;
    padding: 2px 8px;
    border-radius: 4px;
    margin-right: 8px;
  }
  .outline-title { font-weight: 600; font-size: 1.05em; }
  .outline-points { margin-top: 4px; padding-left: 24px; }
  .outline-points li { font-size: 0.9em; color: #777; }
  .outline-points li::before { content: '▸'; color: #d0c0b0; }
  .transcript-section {
    margin-top: 24px;
    border-top: 2px dashed #e0d8c8;
    padding-top: 20px;
  }
  .transcript-toggle {
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 1.1em;
    color: #888;
  }
  .transcript-body {
    display: none;
    margin-top: 12px;
    max-height: 500px;
    overflow-y: auto;
    font-size: 0.9em;
    color: #999;
    line-height: 2;
  }
  .transcript-body .ts {
    color: #e17055;
    font-size: 0.8em;
    margin-right: 8px;
  }

  /* 保存指示器 */
  .save-indicator {
    position: fixed;
    top: 16px;
    right: 20px;
    background: #e8f5e9;
    color: #388e3c;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.8em;
    border: 1px solid #a5d6a7;
    z-index: 1000;
    transition: all 0.3s;
  }
  .save-indicator.saving { background: #fff3e0; color: #f57c00; border-color: #ffcc80; }
  .save-indicator.saved { background: #e8f5e9; color: #388e3c; border-color: #a5d6a7; }

  /* 悬浮工具栏 */
  .toolbar {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    background: #fff;
    padding: 10px 16px;
    border-radius: 28px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12);
    z-index: 999;
  }
  .toolbar button {
    width: 36px; height: 36px;
    border: 1px solid #e0d8c8;
    background: #fffef9;
    border-radius: 50%;
    cursor: pointer;
    font-size: 16px;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .toolbar button:hover { background: #f5f0e8; border-color: #c0b8a8; }
  .toolbar button:active { transform: scale(0.92); }
  .toolbar.hidden { opacity: 0.15; }

  @media (max-width: 600px) {
    .notebook { padding: 30px 18px; }
    h1 { font-size: 1.5em; }
    table { font-size: 0.8em; }
    th, td { padding: 6px 8px; }
  }
</style>
</head>
<body>
<div class="notebook" contenteditable="true">

  <!-- 标题 -->
  <h1>📻 ${escapeHtml(title)}</h1>
  <div class="meta-line">🎧 播客笔记 · ${now}${durationStr ? ' · ⏱ ' + durationStr : ''}</div>

  <!-- 价值主张 -->
  ${valueProposition ? `
  <div class="highlight">💡 ${escapeHtml(valueProposition)}</div>
  ` : ''}

  <!-- 关键词 -->
  ${keywords.length > 0 ? `
  <div class="tags" style="border-top:none;margin-top:0;padding-top:0;">
    ${keywords.map(k => `<span class="tag">#${escapeHtml(k)}</span>`).join('')}
  </div>
  ` : ''}

  <!-- 核心摘要 -->
  ${coreSummary ? `
  <h2>📝 核心摘要</h2>
  <p style="font-size:1.05em;line-height:2;">${escapeHtml(coreSummary)}</p>
  ` : ''}

  <!-- 二级大纲 -->
  ${outline.length > 0 ? `
  <h2>📋 内容大纲</h2>
  ${outline.map(o => `
    <div class="outline-block">
      <div><span class="outline-time">${o.timestamp}</span> <span class="outline-title">${escapeHtml(o.title)}</span></div>
      ${(o.points || []).length > 0 ? `<ul class="outline-points">${o.points.map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>` : ''}
    </div>
  `).join('')}
  ` : ''}

  <!-- Q&A -->
  ${qa.length > 0 ? `
  <h2>💬 深度 Q&A</h2>
  ${qa.map(q => `
    <div class="qa-card">
      <div class="q">Q: ${escapeHtml(q.question)}</div>
      <div class="a">A: ${escapeHtml(q.answer)}</div>
    </div>
  `).join('')}
  ` : ''}

  <!-- 思维模型 -->
  ${mentalModels.length > 0 ? `
  <h2>🧠 思维模型</h2>
  ${mentalModels.map(m => `
    <div class="mental-card">
      <div class="name">${escapeHtml(m.name)}</div>
      <div class="insight">${escapeHtml(m.insight)}</div>
    </div>
  `).join('')}
  ` : ''}

  <!-- 关键金句 -->
  ${keyConclusions.length > 0 ? `
  <h2>💡 关键金句</h2>
  <ul>
    ${keyConclusions.map(c => `<li><mark>${escapeHtml(c)}</mark></li>`).join('')}
  </ul>
  ` : ''}

  <!-- 行动清单 -->
  ${actionItems.length > 0 ? `
  <h2>✅ 行动清单</h2>
  <table>
    <tr><th>类型</th><th>推荐</th><th>理由</th></tr>
    ${actionItems.map(a => `
    <tr>
      <td>${a.type === 'book' ? '📖 书' : a.type === 'tool' ? '🛠 工具' : '💡 方法'}</td>
      <td><strong>${escapeHtml(a.name)}</strong></td>
      <td>${escapeHtml(a.reason)}</td>
    </tr>
    `).join('')}
  </table>
  ` : ''}

  <!-- 转录原文(折叠) -->
  ${segments.length > 0 ? `
  <div class="transcript-section">
    <div class="transcript-toggle" onclick="var b=document.getElementById('tsBody');var s=b.style.display==='none'?'block':'none';b.style.display=s;this.querySelector('.arrow').textContent=s==='none'?'▶':'▼';">
      <span class="arrow">▶</span> 转录原文 (${segments.length} 段)
    </div>
    <div class="transcript-body" id="tsBody">
      ${segments.map(s => `<span class="ts">${s.time}</span>${escapeHtml(s.text)}<br>`).join('')}
    </div>
  </div>
  ` : ''}

  <!-- 标签 -->
  ${keywords.length > 0 ? `
  <div class="tags">
    <span style="color:#aaa;font-size:0.85em;">🏷️</span>
    ${keywords.map(k => `<span class="tag">#${escapeHtml(k)}</span>`).join('')}
  </div>
  ` : ''}

</div>

<!-- 保存指示器 -->
<div class="save-indicator saved" id="saveIndicator">💾 已保存</div>

<!-- 悬浮工具栏 -->
<div class="toolbar" id="toolbar">
  <button onclick="document.execCommand('bold',false,null)" title="加粗">B</button>
  <button onclick="wrapMark('mark')" title="荧光笔">🖍</button>
  <button onclick="wrapMark('pink-mark')" title="粉笔">🩷</button>
  <button onclick="toggleLock()" id="lockBtn" title="锁定/解锁">🔓</button>
  <button onclick="resetContent()" title="恢复原始">🔄</button>
  <button onclick="toggleToolbar()" title="隐藏">👁</button>
</div>

<script>
  const STORAGE_KEY = 'xhnote-' + location.pathname.replace(/[^a-zA-Z0-9]/g, '-');
  const notebook = document.querySelector('.notebook');
  const indicator = document.getElementById('saveIndicator');
  let saveTimer = null;
  const originalHTML = notebook.innerHTML;

  (function restore() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) { notebook.innerHTML = saved; }
  })();

  notebook.addEventListener('input', function() {
    indicator.textContent = '🕐 编辑中...';
    indicator.className = 'save-indicator saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function() {
      localStorage.setItem(STORAGE_KEY, notebook.innerHTML);
      indicator.textContent = '💾 已保存';
      indicator.className = 'save-indicator saved';
    }, 1500);
  });

  function wrapMark(cls) {
    const sel = window.getSelection();
    if (!sel.rangeCount || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    const span = document.createElement('span');
    span.className = cls;
    try { range.surroundContents(span); } catch(e) {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
  }

  function toggleLock() {
    const btn = document.getElementById('lockBtn');
    if (notebook.contentEditable === 'true') {
      notebook.contentEditable = 'false'; btn.textContent = '🔒';
      indicator.textContent = '🔒 已锁定'; indicator.className = 'save-indicator saved';
    } else {
      notebook.contentEditable = 'true'; btn.textContent = '🔓';
      indicator.textContent = '💾 已保存'; indicator.className = 'save-indicator saved';
    }
  }

  function resetContent() {
    if (confirm('恢复原始内容？所有修改将被丢弃。')) {
      localStorage.removeItem(STORAGE_KEY);
      notebook.innerHTML = originalHTML;
      indicator.textContent = '💾 已恢复';
      indicator.className = 'save-indicator saved';
    }
  }

  function toggleToolbar() {
    document.getElementById('toolbar').classList.toggle('hidden');
  }
</script>
</body>
</html>`;
}

function escapeHtml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function saveNote(summary, podcastInfo, transcription) {
  const notesDir = path.join(__dirname, '..', 'public', 'notes');
  if (!fs.existsSync(notesDir)) {
    fs.mkdirSync(notesDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `note_${timestamp}.html`;
  const filepath = path.join(notesDir, filename);

  const html = generateNote(summary, podcastInfo, transcription);
  fs.writeFileSync(filepath, html, 'utf-8');

  return { success: true, filename, url: `/notes/${filename}`, filepath };
}

module.exports = { generateNote, saveNote };
