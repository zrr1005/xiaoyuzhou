FROM node:18-slim

# 系统依赖：ffmpeg（whisper.cpp 需要）、curl（下载用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    curl \
    unzip \
    && rm -rf /var/lib/apt/lists/*

# 工作目录
WORKDIR /app

# ── whisper.cpp 二进制 ────────────────────────────────
RUN mkdir -p /app/data && \
    curl -L -o /tmp/whisper.tar.gz \
      "https://github.com/ggerganov/whisper.cpp/releases/download/v1.7.6/whisper-linux-x64.tar.gz" && \
    tar -xzf /tmp/whisper.tar.gz -C /tmp/ && \
    find /tmp -name 'whisper-cli' -type f -exec cp {} /app/data/whisper-cli \; && \
    chmod +x /app/data/whisper-cli && \
    rm /tmp/whisper.tar.gz && \
    echo "whisper-cli: $(file /app/data/whisper-cli)"

# ── ggml 模型（142MB，构建时下载避免运行时等待）──────
RUN curl -L -o /app/data/ggml-base.bin \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin" && \
    echo "Model downloaded: $(du -h /app/data/ggml-base.bin | cut -f1)"

# ── 应用代码 ──────────────────────────────────────────
COPY package.json package-lock.json* ./
RUN npm install --production

COPY . .

# ── 运行时配置 ────────────────────────────────────────
ENV PORT=7860
ENV NODE_ENV=production

EXPOSE 7860

CMD ["node", "server.js"]
