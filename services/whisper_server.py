import sys
import json
import os
import tempfile
import urllib.request
import threading
import time
import uuid

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

from flask import Flask, request, jsonify

app = Flask(__name__)

MODEL = None
MODEL_SIZE = os.environ.get('WHISPER_MODEL', 'base')
MODEL_LOCK = threading.Lock()
LOADING = False

# 转录任务状态
JOBS = {}
JOBS_LOCK = threading.Lock()


def find_ffmpeg():
    paths = [
        "ffmpeg",
        r"C:\Users\DELL\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe",
    ]
    for p in paths:
        try:
            import subprocess
            subprocess.run([p, "-version"], capture_output=True, check=True)
            return p
        except Exception:
            if os.path.exists(p):
                return p
    return None


def _add_nvidia_dll_paths():
    """添加 pip 安装的 NVIDIA CUDA 库到 DLL 搜索路径"""
    try:
        import site
        for sp in site.getsitepackages():
            nvidia_bin = os.path.join(sp, 'nvidia', 'cublas', 'bin')
            if os.path.isdir(nvidia_bin):
                os.add_dll_directory(nvidia_bin)
                print(f"已添加 DLL 路径: {nvidia_bin}", file=sys.stderr)
            # cuDNN
            cudnn_bin = os.path.join(sp, 'nvidia', 'cudnn', 'bin')
            if os.path.isdir(cudnn_bin):
                os.add_dll_directory(cudnn_bin)
    except Exception as e:
        print(f"添加 DLL 路径警告: {e}", file=sys.stderr)


def load_model():
    global MODEL, LOADING
    with MODEL_LOCK:
        if MODEL is not None:
            return MODEL
        if LOADING:
            return None
        LOADING = True

    try:
        from faster_whisper import WhisperModel
        import ctypes

        # 添加 NVIDIA pip 包的 DLL 搜索路径
        _add_nvidia_dll_paths()

        ffmpeg_path = find_ffmpeg()
        if not ffmpeg_path:
            print("ERROR: ffmpeg not found", file=sys.stderr)
            with MODEL_LOCK:
                LOADING = False
            return None

        os.environ["FFMPEG_PATH"] = ffmpeg_path

        # 检查 GPU 是否真正可用（nvcuda + cuBLAS 缺一不可）
        gpu_available = False
        try:
            ctypes.CDLL("nvcuda.dll")
            ctypes.CDLL("cublas64_12.dll")
            gpu_available = True
        except Exception:
            pass

        if gpu_available:
            device, compute_type = "cuda", "float16"
            print(f"Loading Faster-Whisper model '{MODEL_SIZE}' on GPU (CUDA/float16)...", file=sys.stderr)
        else:
            device, compute_type = "cpu", "int8"
            print(f"cuBLAS 不可用，使用 CPU (int8)...", file=sys.stderr)
            print(f"Loading Faster-Whisper model '{MODEL_SIZE}' on CPU (int8)...", file=sys.stderr)

        model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute_type, num_workers=2)

        # GPU 加载后做一次轻量转录验证，防止加载成功但运行失败的半残状态
        if device == "cuda":
            try:
                import subprocess
                test_audio = os.path.join(tempfile.gettempdir(), "_whisper_gpu_test.wav")
                # 生成 1 秒静音测试文件
                subprocess.run([
                    ffmpeg_path, "-y", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono",
                    "-t", "1", test_audio
                ], capture_output=True, check=True)
                test_segments, _ = model.transcribe(test_audio, language="zh", beam_size=1, vad_filter=False)
                list(test_segments)
                os.remove(test_audio)
            except Exception as e:
                print(f"GPU 运行测试失败 ({e})，回退 CPU 重新加载...", file=sys.stderr)
                device, compute_type = "cpu", "int8"
                model = WhisperModel(MODEL_SIZE, device=device, compute_type=compute_type, num_workers=2)

        with MODEL_LOCK:
            MODEL = model
            LOADING = False
        print(f"Model '{MODEL_SIZE}' ready on {device}/{compute_type}", file=sys.stderr)
        return model
    except Exception as e:
        print(f"Failed to load model: {e}", file=sys.stderr)
        with MODEL_LOCK:
            LOADING = False
        return None


def download_audio(url, output_path):
    proxy = os.environ.get('HTTPS_PROXY') or os.environ.get('HTTP_PROXY') or \
            os.environ.get('https_proxy') or os.environ.get('http_proxy')
    try:
        if proxy:
            proxy_handler = urllib.request.ProxyHandler({'http': proxy, 'https': proxy})
            opener = urllib.request.build_opener(proxy_handler)
        else:
            opener = urllib.request.build_opener()
        opener.addheaders = [('User-Agent', 'Mozilla/5.0')]
        with opener.open(url, timeout=300) as response:
            with open(output_path, 'wb') as f:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
        return output_path
    except Exception as e:
        print(f"Download failed: {e}", file=sys.stderr)
        return None


@app.route('/health', methods=['GET'])
def health():
    return jsonify({
        "status": "ready" if MODEL is not None else ("loading" if LOADING else "no_model"),
        "model": MODEL_SIZE,
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    data = request.get_json(silent=True) or {}
    audio_url = data.get('url') or data.get('path')
    language = data.get('language', 'zh')
    beam_size = data.get('beam_size', 5)
    vad_filter = data.get('vad_filter', False)

    if not audio_url:
        return jsonify({"success": False, "error": "Missing audio URL or path"}), 400

    model = MODEL
    if model is None:
        load_model()
        waited = 0
        while MODEL is None and LOADING and waited < 60:
            time.sleep(0.5)
            waited += 0.5
        model = MODEL

    if model is None:
        return jsonify({"success": False, "error": "Model not loaded"}), 503

    # 下载音频
    temp_audio = None
    if audio_url.startswith('http://') or audio_url.startswith('https://'):
        temp_audio = os.path.join(tempfile.gettempdir(), f"whisper_{os.urandom(8).hex()}.mp3")
        print(f"Downloading audio from {audio_url}...", file=sys.stderr)
        start = time.time()
        downloaded = download_audio(audio_url, temp_audio)
        if not downloaded:
            return jsonify({"success": False, "error": "Failed to download audio"}), 500
        print(f"Downloaded in {time.time() - start:.1f}s", file=sys.stderr)
        audio_path = temp_audio
    else:
        audio_path = audio_url
        if not os.path.exists(audio_path):
            return jsonify({"success": False, "error": f"File not found: {audio_path}"}), 404

    job_id = uuid.uuid4().hex
    job = {
        'id': job_id,
        'status': 'transcribing',
        'segments': [],
        'full_text': '',
        'language': '',
        'duration': 0,
        'error': None,
        'elapsed': 0,
        'temp_audio': temp_audio,
    }
    with JOBS_LOCK:
        JOBS[job_id] = job

    # 后台线程执行转录
    thread = threading.Thread(
        target=_do_transcribe,
        args=(job_id, audio_path, temp_audio, language, beam_size, vad_filter),
        daemon=True
    )
    thread.start()

    return jsonify({"success": True, "job_id": job_id})


def _do_transcribe(job_id, audio_path, temp_audio, language, beam_size, vad_filter):
    """后台转录线程"""
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return

    try:
        start = time.time()
        segments_gen, info = MODEL.transcribe(
            audio_path,
            language=language,
            beam_size=beam_size,
            vad_filter=vad_filter
        )

        all_segments = []
        full_text_parts = []
        for segment in segments_gen:
            seg = {"text": segment.text.strip(), "start": segment.start, "end": segment.end}
            all_segments.append(seg)
            full_text_parts.append(segment.text.strip())

            # 每 10 段更新一次 job 状态
            if len(all_segments) % 10 == 0:
                with JOBS_LOCK:
                    if job_id in JOBS:
                        JOBS[job_id]['segments'] = all_segments[:]
                        JOBS[job_id]['full_text'] = " ".join(full_text_parts)
                        JOBS[job_id]['elapsed'] = round(time.time() - start, 1)

        elapsed = round(time.time() - start, 1)
        full_text = " ".join(full_text_parts)
        duration = all_segments[-1]['end'] if all_segments else 0

        print(f"Transcription done in {elapsed}s, {len(all_segments)} segments", file=sys.stderr)

        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id].update({
                    'status': 'done',
                    'segments': all_segments,
                    'full_text': full_text,
                    'language': info.language,
                    'duration': duration,
                    'elapsed': elapsed,
                })
    except Exception as e:
        print(f"Transcription error: {e}", file=sys.stderr)
        with JOBS_LOCK:
            if job_id in JOBS:
                JOBS[job_id]['status'] = 'error'
                JOBS[job_id]['error'] = str(e)
    finally:
        if temp_audio and os.path.exists(temp_audio):
            os.remove(temp_audio)

        # 5 分钟后清理 job
        def _cleanup():
            time.sleep(300)
            with JOBS_LOCK:
                JOBS.pop(job_id, None)
        threading.Thread(target=_cleanup, daemon=True).start()


@app.route('/transcribe/progress/<job_id>', methods=['GET'])
def transcribe_progress(job_id):
    with JOBS_LOCK:
        job = JOBS.get(job_id)
    if not job:
        return jsonify({"success": False, "error": "Job not found"}), 404

    segs = job['segments']
    return jsonify({
        "success": True,
        "status": job['status'],
        "segments": segs[-200:],  # 最近 200 段
        "segment_count": len(segs),
        "full_text": job['full_text'][-10000:] if job['full_text'] else '',
        "language": job['language'],
        "duration": job['duration'],
        "elapsed": job.get('elapsed', 0),
        "error": job['error'],
    })


if __name__ == '__main__':
    port = int(os.environ.get('WHISPER_PORT', 5001))

    print(f"Starting Whisper server, pre-loading model '{MODEL_SIZE}'...", file=sys.stderr)
    load_model()

    print(f"Whisper server listening on http://127.0.0.1:{port}", file=sys.stderr)
    app.run(host='127.0.0.1', port=port, debug=False, threaded=True)
