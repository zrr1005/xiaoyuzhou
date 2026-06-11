---
title: 小宇宙播客 AI 总结助手
emoji: 📻
colorFrom: orange
colorTo: blue
sdk: docker
pinned: false
---

# 📻 小宇宙播客 AI 总结助手

粘贴小宇宙播客链接 → 自动转录 → AI 深度总结 → 小红书风格笔记

## 特性

- **零 GPU 依赖**：基于 whisper.cpp，纯 CPU 转录
- **8 维度 AI 总结**：价值主张 / 核心摘要 / Q&A / 思维模型 / 行动清单…
- **实时进度**：流式回传转录文字，ETA 预估
- **多用户支持**：昵称登录，数据完全隔离
- **一键部署**：Docker 镜像，开箱即用

## 使用

1. 打开应用，输入昵称登录
2. 粘贴小宇宙播客链接
3. 等待转录和 AI 总结完成
4. 查看深度总结 / 下载原文 / 生成小红书笔记

## 环境变量

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（必需） |
| `PORT` | 服务端口（默认 7860） |

## 技术栈

Node.js · whisper.cpp · DeepSeek V4 · SQLite · Docker
