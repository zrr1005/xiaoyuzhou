import sys
import json
import os

# 强制使用 UTF-8 编码，防止 Windows 默认 GBK 导致乱码
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

def download_audio(url, output_path):
    try:
        # 读取代理环境变量（与 Node.js 侧保持一致）
        proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY') or \
                os.environ.get('https_proxy') or os.environ.get('http_proxy')

        import urllib.request
        if proxy:
            proxy_handler = urllib.request.ProxyHandler({'http': proxy, 'https': proxy})
            opener = urllib.request.build_opener(proxy_handler)
        else:
            opener = urllib.request.build_opener()

        opener.addheaders = [('User-Agent', 'Mozilla/5.0')]
        with opener.open(url, timeout=120) as response:
            with open(output_path, 'wb') as f:
                f.write(response.read())
        return output_path
    except Exception as e:
        print(f"下载失败: {e}", file=sys.stderr)
        return None

def transcribe(audio_path, model_size="base", language="zh"):
    try:
        from faster_whisper import WhisperModel
        import ctypes
        import subprocess

        # 显式检查 ffmpeg 是否可用
        ffmpeg_path = "ffmpeg"
        winget_ffmpeg = r"C:\Users\DELL\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe"
        
        try:
            subprocess.run([ffmpeg_path, "-version"], capture_output=True, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError):
            # 尝试使用刚刚安装的 Winget 路径
            if os.path.exists(winget_ffmpeg):
                ffmpeg_path = winget_ffmpeg
                print(f"使用手动指定的 ffmpeg 路径: {ffmpeg_path}", file=sys.stderr)
            else:
                return {
                    "success": False,
                    "error": "系统中未找到 ffmpeg。本地转录需要安装 ffmpeg 并将其添加到系统 PATH 中。"
                }

        # 尝试使用 GPU，如果失败则回退到 CPU
        device, compute_type = "cuda", "float16"
        try:
            # 1. 预读 nvcuda.dll
            ctypes.CDLL("nvcuda.dll")
            
            print("Trying GPU device...", file=sys.stderr)
            model = WhisperModel(model_size, device=device, compute_type=compute_type, num_workers=2)
            
            # 尝试执行转录。注意：Faster-Whisper 是延迟加载的，实际库错误可能在开始处理时才抛出
            segments_gen, info = model.transcribe(
                audio_path,
                language=language,
                beam_size=5,
                vad_filter=True
            )
            # 强制预取一段，以触发库加载检查
            all_segments = list(segments_gen)
            print("GPU transcription successful", file=sys.stderr)

        except Exception as e:
            err_str = str(e)
            if "cublas" in err_str.lower() or "cudnn" in err_str.lower() or "cuda" in err_str.lower() or "nvcuda" in err_str.lower():
                print("GPU initialization failed, falling back to CPU...", file=sys.stderr)
            else:
                print("Transcription error, retrying with CPU...", file=sys.stderr)
            
            device, compute_type = "cpu", "int8"
            print("Using CPU mode", file=sys.stderr)
            model = WhisperModel(model_size, device=device, compute_type=compute_type, num_workers=2)
            segments_gen, info = model.transcribe(
                audio_path,
                language=language,
                beam_size=5,
                vad_filter=True
            )
            all_segments = list(segments_gen)

        full_text = " ".join(s.text.strip() for s in all_segments)

        return {
            "success": True,
            "text": full_text,
            "language": info.language,
            "segments": [{"text": s.text.strip(), "start": s.start, "end": s.end} for s in all_segments]
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"转录彻底失败: {str(e)}"
        }

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing parameters"}))
        sys.exit(1)

    audio_url = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 else "zh"

    temp_audio = "temp_audio.mp3"

    print(f"Downloading audio from: {audio_url}", file=sys.stderr)
    downloaded_path = download_audio(audio_url, temp_audio)

    if not downloaded_path:
        print(json.dumps({"success": False, "error": "Failed to download audio"}))
        sys.exit(1)

    print(f"Transcribing audio...", file=sys.stderr)
    result = transcribe(downloaded_path, model_size="base", language=language)

    if os.path.exists(temp_audio):
        os.remove(temp_audio)

    print(json.dumps(result, ensure_ascii=False))
