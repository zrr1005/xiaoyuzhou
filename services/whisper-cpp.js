const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const axios = require('axios');

// ── 路径 ──────────────────────────────────────────────
const DATA_DIR = path.join(__dirname, '..', 'data');
const MODEL_NAME = 'ggml-base.bin';
const MODEL_PATH = path.join(DATA_DIR, MODEL_NAME);

// whisper.cpp 二进制
const platform = os.platform();
let BINARY_NAME = 'whisper-cli';
if (platform === 'win32') BINARY_NAME = 'whisper-cli.exe';
const BINARY_PATH = path.join(DATA_DIR, BINARY_NAME);

// 下载源
const WHISPER_RELEASE = 'https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.6';
const MODEL_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin';

const PLATFORM_MAP = {
  win32: 'whisper-bin-x64.zip',
  linux: 'whisper-linux-x64.tar.gz',
  darwin: 'whisper-macos-x64.tar.gz',
};

// ── 下载工具 ──────────────────────────────────────────
async function downloadFile(url, destPath, label) {
  const writer = fs.createWriteStream(destPath);
  const response = await axios({ url, method: 'GET', responseType: 'stream', timeout: 600000 });
  const total = parseInt(response.headers['content-length'], 10) || 0;
  let downloaded = 0;

  return new Promise((resolve, reject) => {
    response.data.on('data', chunk => {
      downloaded += chunk.length;
      if (total > 0 && downloaded % (1024 * 1024 * 5) < chunk.length) {
        process.stdout.write(`\r  ${label}: ${(downloaded / 1024 / 1024).toFixed(1)}MB`);
      }
    });
    response.data.pipe(writer);
    writer.on('finish', () => { process.stdout.write(`\r  ${label}: OK\n`); writer.close(); resolve(); });
    writer.on('error', reject);
    response.data.on('error', reject);
  });
}

async function downloadAndExtractZip(url, destDir, binaryName) {
  // 简单方案：直接下载二进制文件
  const { execSync } = require('child_process');
  const AdmZip = require('adm-zip'); // 可能需要安装
  // 为了避免额外依赖，使用系统工具
  if (platform === 'win32') {
    // PowerShell 解压
    const zipPath = path.join(os.tmpdir(), 'whisper-cpp.zip');
    await downloadFile(url, zipPath, 'whisper.cpp binary');
    execSync(`powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`, { stdio: 'ignore' });
    fs.unlinkSync(zipPath);
    // 找到解压后的二进制文件
    const files = fs.readdirSync(destDir, { recursive: true });
    const binary = files.find(f => f.endsWith('.exe') && f.includes('whisper'));
    if (binary) {
      fs.copyFileSync(path.join(destDir, binary), path.join(destDir, BINARY_NAME));
    }
  } else {
    const tarPath = path.join(os.tmpdir(), 'whisper-cpp.tar.gz');
    await downloadFile(url, tarPath, 'whisper.cpp binary');
    execSync(`tar -xzf "${tarPath}" -C "${destDir}"`, { stdio: 'ignore' });
    fs.unlinkSync(tarPath);
  }
}

// ── 初始化（首次启动下载二进制和模型） ────────────────
let initialized = false;

async function ensureReady() {
  if (initialized) return;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

  // 1. 检查/下载 whisper.cpp 二进制
  if (!fs.existsSync(BINARY_PATH)) {
    console.log('[whisper.cpp] 二进制未找到，正在下载...');
    const archUrl = `${WHISPER_RELEASE}/${PLATFORM_MAP[platform]}`;
    if (!PLATFORM_MAP[platform]) {
      throw new Error(`不支持的系统: ${platform}`);
    }
    await downloadAndExtractZip(archUrl, DATA_DIR, BINARY_NAME);
    if (!fs.existsSync(BINARY_PATH)) {
      // 备选：使用系统安装的 whisper
      throw new Error('whisper.cpp 下载失败，请手动安装 whisper.cpp');
    }
    console.log('[whisper.cpp] 二进制就绪');
  }

  // 2. 检查/下载模型文件
  if (!fs.existsSync(MODEL_PATH)) {
    console.log('[whisper.cpp] 模型文件未找到，正在下载...（约 142MB，仅首次）');
    await downloadFile(MODEL_URL, MODEL_PATH, 'ggml-base.bin');
    console.log('[whisper.cpp] 模型就绪');
  }

  initialized = true;
}

// ── 执行转录 ──────────────────────────────────────────
function runTranscription(audioPath, options = {}) {
  const {
    language = 'zh',
    beamSize = 5,
    threads = Math.max(1, os.cpus().length - 1),
  } = options;

  const outputJson = audioPath + '.json';

  const args = [
    '-m', MODEL_PATH,
    '-f', audioPath,
    '-l', language,
    '-bs', String(beamSize),
    '-t', String(threads),
    '-oj',           // JSON 输出
    '-of', audioPath, // 输出文件前缀
    '--no-timestamps', 'false',
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn(BINARY_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    const progressRegex = /progress\s*=\s*(\d+)%/;

    proc.stderr.on('data', d => {
      const text = d.toString('utf-8');
      stderr += text;
      // 解析进度
      const match = text.match(progressRegex);
      if (match && options.onProgress) {
        const pct = parseInt(match[1], 10);
        options.onProgress(pct);
      }
    });

    proc.on('close', code => {
      if (code !== 0) {
        return reject(new Error(`whisper.cpp exit ${code}: ${stderr.slice(-200)}`));
      }

      // 读取 JSON 输出
      try {
        const json = JSON.parse(fs.readFileSync(outputJson, 'utf-8'));
        // 格式化为统一结构
        const segments = (json.transcription || []).map(seg => {
          // offsets 单位是毫秒
          const fromMs = seg.offsets?.from || 0;
          const toMs = seg.offsets?.to || 0;
          return {
            start: fromMs / 1000,
            end: toMs / 1000,
            text: (seg.text || '').trim(),
          };
        }).filter(s => s.text);

        // 清理临时 JSON 文件
        try { fs.unlinkSync(outputJson); } catch {}

        resolve(segments);
      } catch (e) {
        reject(new Error(`解析转录结果失败: ${e.message}`));
      }
    });

    proc.on('error', reject);
  });
}

module.exports = { ensureReady, runTranscription, BINARY_PATH, MODEL_PATH };
