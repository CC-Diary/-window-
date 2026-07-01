const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile, spawn } = require('child_process');

let mainWindow;
let safeBinPath = null; // 无中文的 ffmpeg 路径，避免 spawn 编码乱码

// 确保 ffmpeg 在一个不含中文的路径可用（spawn env 传中文会乱码）
function ensureFfmpegSafePath() {
  if (safeBinPath && fs.existsSync(path.join(safeBinPath, 'ffmpeg.exe'))) return safeBinPath;
  const candidates = [
    'C:\\ffmpeg\\bin',
    path.join(os.homedir(), 'ffmpeg', 'bin'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'ffmpeg.exe'))) { safeBinPath = dir; return dir; }
  }
  // 从项目 bin 复制到 C:\ffmpeg\bin
  const srcBin = app.isPackaged ? path.join(process.resourcesPath, 'bin') : path.join(__dirname, 'bin');
  const dstBin = 'C:\\ffmpeg\\bin';
  try {
    fs.mkdirSync(dstBin, { recursive: true });
    for (const exe of ['ffmpeg.exe', 'ffprobe.exe']) {
      const src = path.join(srcBin, exe);
      const dst = path.join(dstBin, exe);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    safeBinPath = dstBin;
    return dstBin;
  } catch (err) {
    debugLog('ensureFfmpegSafePath error: ' + err.message);
    return srcBin; // fallback
  }
}

function getDebugLogPath() {
  return path.join(app.getPath('temp'), 'vfx-debug.log');
}

function debugLog(msg) {
  try { fs.appendFileSync(getDebugLogPath(), `[${new Date().toISOString()}] ${msg}\n`); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200, height: 800,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    title: '视频特效助手', resizable: true
  });
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

app.whenReady().then(async () => {
  createWindow();
  const ffmpegPath = findFfmpeg();
  if (!fs.existsSync(ffmpegPath)) {
    debugLog('ffmpeg not found, attempting auto-download');
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.send('auto-download-ffmpeg');
    });
  }
});
app.on('window-all-closed', () => app.quit());

// 查找ffmpeg - 按优先级搜索
function findFfmpeg() {
  const candidates = [
    app.isPackaged ? path.join(process.resourcesPath, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : null,
    path.join(__dirname, 'bin', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'),
    'C:\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
}

function runFfmpeg(args, timeout) {
  return new Promise(resolve => {
    const ffmpegPath = findFfmpeg();
    execFile(ffmpegPath, args, { timeout: timeout || 30000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout || '', stderr: stderr || '', err });
    });
  });
}

// 获取视频信息
ipcMain.handle('get-video-info', async (e, fp) => {
  const { stderr, err } = await runFfmpeg(['-i', fp], 10000);
  const out = stderr;
  const durMatch = out.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  const vidMatch = out.match(/Video:\s*\w+.*?,\s*(\d+)x(\d+)/);
  const codecMatch = out.match(/Video:\s*(\w+)/);
  if (!durMatch) return { error: err ? err.message : '无法识别视频格式' };
  return {
    width: vidMatch ? parseInt(vidMatch[1]) : 0,
    height: vidMatch ? parseInt(vidMatch[2]) : 0,
    duration: parseInt(durMatch[1]) * 3600 + parseInt(durMatch[2]) * 60 + parseFloat(durMatch[3]),
    codec: codecMatch ? codecMatch[1] : 'unknown',
    size: 0
  };
});

// 提取音频
ipcMain.handle('extract-audio', async (e, video, out) => {
  debugLog(`extract-audio: ${video} -> ${out}`);
  const { err } = await runFfmpeg(['-y', '-i', video, '-vn', '-acodec', 'pcm_s16le', '-ar', '16000', '-ac', '1', out]);
  const success = !err;
  debugLog(`extract-audio result: ${success}`);
  return err ? { error: err.message } : { success: true };
});

// 转码H.264
ipcMain.handle('transcode-to-h264', async (e, input, out) => {
  const { err } = await runFfmpeg(['-y', '-i', input, '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-c:a', 'aac', '-r', '30', '-g', '30', '-keyint_min', '30', '-movflags', '+faststart', out]);
  return err ? { error: err.message } : { success: true };
});

// 写文件
ipcMain.handle('write-html', async (e, fp, content) => {
  try {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content, 'utf-8');
    debugLog(`write-html: ${fp} (${content.length} bytes)`);
    return { success: true };
  } catch (err) {
    debugLog(`write-html ERROR: ${err.message}`);
    return { error: err.message };
  }
});

// ==================== 云端语音识别 ====================
// 阿里云Paraformer / OpenAI Whisper API
ipcMain.handle('cloud-asr', async (e, audioPath, provider, apiKey) => {
  debugLog(`cloud-asr: provider=${provider} audio=${audioPath}`);
  apiKey = (apiKey || '').replace(/[^\x00-\x7F]/g, '').trim();
  if (!apiKey) return { error: '请先在左侧填写 API Key' };

  try {
    const audioBuffer = fs.readFileSync(audioPath);
    let url, headers, body;

    if (provider === 'qwen' || provider === 'deepseek') {
      // 阿里云 DashScope Paraformer-v2 - 异步模式（提交任务 → 轮询结果）
      const base64 = audioBuffer.toString('base64');
      const dataUrl = 'data:audio/wav;base64,' + base64;
      const submitBody = JSON.stringify({
        model: 'paraformer-v2',
        input: { file_urls: [dataUrl] }
      });

      // 1. 提交识别任务（必须加 X-DashScope-Async 头）
      const submitRes = await new Promise((resolve) => {
        const opts = {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + apiKey,
            'Content-Type': 'application/json',
            'Content-Length': String(Buffer.byteLength(submitBody)),
            'X-DashScope-Async': 'enable'
          },
          timeout: 120000
        };
        const req = require('https').request('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', opts, (res) => {
          let d = '';
          res.on('data', c => { d += c; });
          res.on('end', () => {
            debugLog(`cloud-asr submit HTTP ${res.statusCode}: ${d.substring(0, 300)}`);
            try { resolve(JSON.parse(d)); } catch { resolve({ error: d }); }
          });
        });
        req.on('error', err => resolve({ error: err.message }));
        req.setTimeout(120000, () => { req.destroy(); resolve({ error: '提交超时' }); });
        req.write(submitBody);
        req.end();
      });

      if (submitRes.error) return { error: submitRes.error };
      if (submitRes.code) return { error: submitRes.message || submitRes.code };

      const taskId = submitRes.output?.task_id;
      if (!taskId) return { error: '未获取到任务ID，响应: ' + JSON.stringify(submitRes).substring(0, 200) };

      debugLog(`cloud-asr taskId: ${taskId}`);

      // 2. 轮询结果（最多等60秒）
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));

        const pollRes = await new Promise((resolve) => {
          const opts = {
            method: 'GET',
            headers: { 'Authorization': 'Bearer ' + apiKey },
            timeout: 10000
          };
          const req = require('https').request(`https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`, opts, (res) => {
            let d = '';
            res.on('data', c => { d += c; });
            res.on('end', () => {
              try { resolve(JSON.parse(d)); } catch { resolve(null); }
            });
          });
          req.on('error', () => resolve(null));
          req.setTimeout(10000, () => { req.destroy(); resolve(null); });
          req.end();
        });

        if (!pollRes) { debugLog(`cloud-asr poll ${i}: null`); continue; }
        debugLog(`cloud-asr poll ${i} raw: ${JSON.stringify(pollRes).substring(0, 200)}`);
        const status = pollRes.output?.task_status;
        debugLog(`cloud-asr poll ${i}: status=${status}`);

        if (status === 'SUCCEEDED') {
          const results = pollRes.output.results || [];
          if (results.length > 0 && results[0].transcription_url) {
            // 获取转录文本
            const textResult = await new Promise((resolve) => {
              require('https').get(results[0].transcription_url, (res) => {
                let d = '';
                res.on('data', c => { d += c; });
                res.on('end', () => {
                  try {
                    const json = JSON.parse(d);
                    const text = json.transcripts?.map(t => t.text).join('') || json.text || '';
                    resolve(text);
                  } catch { resolve(d); }
                });
              }).on('error', () => resolve(''));
            });
            return { success: true, text: textResult };
          }
          return { error: '识别完成但未获取到文本' };
        }
        if (status === 'FAILED') {
          return { error: '识别失败: ' + (pollRes.output?.message || '') };
        }
      }
      return { error: '识别超时，请重试' };
    } else if (provider === 'openai') {
      // OpenAI Whisper API
      const boundary = '----Boundary' + Math.random().toString(36).slice(2);
      const CRLF = '\r\n';
      const chunks = [];
      chunks.push(Buffer.from(`--${boundary}${CRLF}`));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="model"${CRLF}${CRLF}whisper-1${CRLF}`));
      chunks.push(Buffer.from(`--${boundary}${CRLF}`));
      chunks.push(Buffer.from(`Content-Disposition: form-data; name="file"; filename="audio.wav"${CRLF}Content-Type: audio/wav${CRLF}${CRLF}`));
      chunks.push(audioBuffer);
      chunks.push(Buffer.from(`${CRLF}--${boundary}--${CRLF}`));
      body = Buffer.concat(chunks);

      url = 'https://api.openai.com/v1/audio/transcriptions';
      headers = {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'multipart/form-data; boundary=' + boundary,
        'Content-Length': String(body.length)
      };
    } else if (provider === 'anthropic') {
      return { error: 'Anthropic 不支持语音识别，请换用阿里云或 OpenAI 引擎' };
    } else if (provider === 'ollama') {
      return { error: 'Ollama 不支持云端语音识别，请换用阿里云或 OpenAI 引擎，或直接粘贴文案' };
    } else {
      return { error: '不支持的引擎: ' + provider };
    }

    const result = await new Promise((resolve) => {
      const httpMod = url.startsWith('https') ? require('https') : require('http');
      const req = httpMod.request(url, { method: 'POST', headers, timeout: 120000 }, (res) => {
        let data = '';
        res.on('data', c => { data += c; });
        res.on('end', () => {
          debugLog(`cloud-asr HTTP ${res.statusCode}: ${data.substring(0, 500)}`);
          try {
            const json = JSON.parse(data);
            if (json.text) {
              resolve({ success: true, text: json.text });
            } else if (json.output && json.output.text) {
              resolve({ success: true, text: json.output.text });
            }
            // 异步任务（轮询暂不支持，提示重试）
            else if (json.output && json.output.task_id) {
              resolve({ error: '异步任务暂不支持，请稍后重试' });
            } else {
              const errMsg = json.message || json.code || '识别失败，请检查API Key是否有效';
              resolve({ error: errMsg });
            }
          } catch { resolve({ error: '解析返回结果失败' }); }
        });
      });
      req.on('error', err => resolve({ error: '网络错误: ' + err.message }));
      req.setTimeout(120000, () => { req.destroy(); resolve({ error: '请求超时（2分钟）' }); });
      req.write(body);
      req.end();
    });

    if (result.success) return result;
    return { error: result.error };
  } catch (err) {
    debugLog('cloud-asr error: ' + err.message);
    return { error: err.message };
  }
});

// ==================== 以下保持不变 ====================

// 自动下载ffmpeg（首次运行时）
ipcMain.handle('ensure-ffmpeg', async () => {
  const ffmpegPath = findFfmpeg();
  if (fs.existsSync(ffmpegPath)) return { success: true, path: ffmpegPath };

  const binDir = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(__dirname, 'bin');
  fs.mkdirSync(binDir, { recursive: true });
  const targetPath = path.join(binDir, 'ffmpeg.exe');

  debugLog(`downloading ffmpeg to ${targetPath}`);

  return new Promise(resolve => {
    const url = 'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip';
    const zipPath = targetPath + '.zip';
    const tempDir = path.join(binDir, 'temp');

    const ps = [
      `[Console]::OutputEncoding = [Text.Encoding]::UTF8`,
      `Write-Host 'DOWNLOAD_START'`,
      `Invoke-WebRequest -Uri "${url}" -OutFile "${zipPath}"`,
      `Write-Host 'DOWNLOAD_DONE'`,
      `Write-Host 'EXTRACT_START'`,
      `Expand-Archive -Path "${zipPath}" -DestinationPath "${tempDir}" -Force`,
      `Get-ChildItem -Path "${tempDir}" -Recurse -Filter "ffmpeg.exe" | Select-Object -First 1 | ForEach-Object { Copy-Item $_.FullName "${targetPath}" -Force }`,
      `Remove-Item "${zipPath}" -Force -ErrorAction SilentlyContinue`,
      `Remove-Item "${tempDir}" -Recurse -Force -ErrorAction SilentlyContinue`,
      `Write-Host 'EXTRACT_DONE'`
    ].join('; ');

    const child = spawn('powershell', ['-NoProfile', '-Command', ps], {
      windowsHide: false
    });

    child.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      debugLog('ffmpeg-dl: ' + msg);
      if (msg.includes('%') || msg.includes('DOWNLOAD') || msg.includes('EXTRACT')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('ffmpeg-download-progress', msg);
        }
      }
    });

    child.stderr.on('data', (data) => {
      debugLog('ffmpeg-dl-err: ' + data.toString().trim());
    });

    child.on('close', (code) => {
      if (code !== 0 || !fs.existsSync(targetPath)) {
        debugLog('ffmpeg download failed: code=' + code);
        resolve({ error: 'ffmpeg下载失败，请手动下载并放到 bin\\ 目录。下载地址: https://www.gyan.dev/ffmpeg/builds/' });
      } else {
        debugLog('ffmpeg downloaded OK');
        resolve({ success: true, path: targetPath });
      }
    });
  });
});

// 选择保存位置
ipcMain.handle('select-save-path', async (e, defaultName) => {
  const r = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName,
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  });
  return r.canceled ? null : r.filePath;
});

// 清理临时文件
ipcMain.handle('cleanup-project', async (e, projectDir) => {
  try {
    const files = ['audio.wav', 'preview.mp4'];
    files.forEach(f => {
      const fp = path.join(projectDir, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    });
    const snapDir = path.join(projectDir, 'snapshots');
    if (fs.existsSync(snapDir)) fs.rmSync(snapDir, { recursive: true });
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

// 查找hyperframes命令 - 优先本地node_modules
function findHyperframesCmd() {
  if (process.platform === 'win32') {
    const localCmd = path.join(__dirname, 'node_modules', '.bin', 'hyperframes.cmd');
    if (fs.existsSync(localCmd)) return localCmd;
    return 'npx.cmd';
  } else {
    const localCmd = path.join(__dirname, 'node_modules', '.bin', 'hyperframes');
    if (fs.existsSync(localCmd)) return localCmd;
    return 'npx';
  }
}

// HyperFrames渲染
ipcMain.handle('hyperframes-render', async (e, dir, out, preview, quality, fps) => {
  debugLog(`render: out=${out} preview=${preview} quality=${quality} fps=${fps}`);
  return new Promise(resolve => {
    const cmd = findHyperframesCmd();
    const q = preview ? 'draft' : (quality || 'standard');
    const f = preview ? 15 : (fps || 30);
    const isNpx = cmd.includes('npx');
    const args = isNpx
      ? ['hyperframes', 'render', '-o', out, '--quality', q, '-f', String(f)]
      : ['render', '-o', out, '--quality', q, '-f', String(f)];
    const binPath = ensureFfmpegSafePath();
    const child = spawn(cmd, args, {
      cwd: dir,
      shell: true,
      env: {
        ...process.env,
        PATH: binPath + ';' + (process.env.PATH || ''),
      }
    });
    let log = '';
    child.stdout.on('data', d => { log += d.toString(); });
    child.stderr.on('data', d => { log += d.toString(); });
    child.on('close', code => {
      debugLog(`render result: code=${code}`);
      resolve(code === 0 ? { success: true } : { error: log });
    });
  });
});

// HyperFrames快照
ipcMain.handle('hyperframes-snapshot', async (e, dir, time) => {
  debugLog(`snapshot: dir=${dir} time=${time}`);
  return new Promise(resolve => {
    const cmd = findHyperframesCmd();
    const isNpx = cmd.includes('npx');
    const args = isNpx
      ? ['hyperframes', 'snapshot', '--at', String(time), '--timeout', '10000']
      : ['snapshot', '--at', String(time), '--timeout', '10000'];
    const binPath = ensureFfmpegSafePath();
    const child = spawn(cmd, args, {
      cwd: dir,
      shell: true,
      env: {
        ...process.env,
        PATH: binPath + ';' + (process.env.PATH || ''),
      }
    });
    let log = '';
    child.stdout.on('data', d => { log += d.toString(); });
    child.stderr.on('data', d => { log += d.toString(); });
    child.on('close', code => {
      debugLog(`snapshot result: code=${code}`);
      if (code === 0) {
        const snapDir = path.join(dir, 'snapshots');
        const files = fs.existsSync(snapDir) ? fs.readdirSync(snapDir).filter(f => f.endsWith('.png')) : [];
        resolve({ success: true, image: files.length > 0 ? path.join(snapDir, files[0]) : null });
      } else { resolve({ error: log }); }
    });
  });
});

ipcMain.handle('read-file-base64', async (e, fp) => {
  try { return { data: fs.readFileSync(fp).toString('base64') }; }
  catch (err) { return { error: err.message }; }
});

// 复制资源文件（字体 + GSAP动画库）
ipcMain.handle('copy-fonts', async (e, projectDir) => {
  const fontsDir = path.join(projectDir, 'fonts');
  fs.mkdirSync(fontsDir, { recursive: true });
  const srcFonts = app.isPackaged ? path.join(process.resourcesPath, 'fonts') : path.join(__dirname, 'fonts');
  try {
    for (const f of ['NotoSansSC-Regular.ttf', 'NotoSansSC-Bold.ttf', 'NotoSansSC-Black.ttf']) {
      const src = path.join(srcFonts, f);
      const dst = path.join(fontsDir, f);
      if (fs.existsSync(src) && !fs.existsSync(dst)) fs.copyFileSync(src, dst);
    }
    const gsapSrc = path.join(__dirname, 'src', 'gsap.min.js');
    const gsapDst = path.join(projectDir, 'gsap.min.js');
    if (fs.existsSync(gsapSrc) && !fs.existsSync(gsapDst)) fs.copyFileSync(gsapSrc, gsapDst);
    return { success: true };
  } catch (err) { return { error: err.message }; }
});

// 检查ffmpeg
ipcMain.handle('check-ffmpeg', async () => {
  const { err } = await runFfmpeg(['-version'], 5000);
  return !err;
});

// 选择文件
ipcMain.handle('select-video', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    filters: [{ name: 'Video', extensions: ['mp4', 'mov', 'avi', 'mkv', 'webm'] }]
  });
  return r.canceled ? null : r.filePaths[0];
});
