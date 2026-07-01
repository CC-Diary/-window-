const { ipcRenderer, shell } = require('electron');
const path = require('path');
const fs = require('fs');

let state = {
  mode: null,
  videoPath: null, projectDir: null,
  keywords: [], title: '', subtitle: '',
  htmlCode: '', outputPath: null, confirmedPreview: false,
  segments: [], effectsPlan: []
};
const $ = s => document.querySelector(s);
const $$ = s => document.querySelectorAll(s);

// ===== 获取配置 =====
function getASRKey() { return $('#asrApiKey')?.value?.trim() || ''; }
function getAIProvider() { return $('#aiProvider')?.value || 'deepseek'; }
function getAIKey() { return $('#aiApiKey')?.value?.trim() || ''; }

// ===== 模式选择 =====
window.selectMode = function(mode) {
  state.mode = mode;
  $('#modeA').style.borderColor = mode === 'talk' ? '#F59E0B' : '#333';
  $('#modeB').style.borderColor = mode === 'subtitle' ? '#F59E0B' : '#333';
  $('#modeIndicator').textContent = '当前模式: ' + (mode === 'talk' ? '🎙️ 口播加特效' : '📝 配字幕特效');
  setTimeout(() => goStep(1), 300);
};

// ===== 导航 =====
$$('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const step = parseInt(btn.dataset.step);
    if (step >= 1 && !state.mode) return alert('请先选择模式');
    if (step >= 2 && !state.videoPath) return alert('请先导入视频');
    if (step >= 3 && !state.htmlCode) return alert('请先AI分析');
    if (step >= 4 && !state.confirmedPreview) return alert('请先预览确认');
    $$('.step').forEach(s => s.classList.remove('active'));
    $$('.nav-btn').forEach(b => b.classList.remove('active'));
    $(`#step${step}`).classList.add('active');
    btn.classList.add('active');
  });
});

function goStep(n) {
  $$('.step').forEach(s => s.classList.remove('active'));
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  $(`#step${n}`).classList.add('active');
  $(`[data-step="${n}"]`).classList.add('active');
}

// ==================== Step 1: 导入 ====================
$('#btnSelectFile').addEventListener('click', async () => {
  const fp = await ipcRenderer.invoke('select-video');
  if (fp) loadVideo(fp);
});

const dropzone = $('#dropzone');
dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = '#F59E0B'; });
dropzone.addEventListener('dragleave', () => { dropzone.style.borderColor = ''; });
dropzone.addEventListener('drop', async e => {
  e.preventDefault(); dropzone.style.borderColor = '';
  if (e.dataTransfer.files.length && e.dataTransfer.files[0].path) loadVideo(e.dataTransfer.files[0].path);
});
dropzone.addEventListener('click', async e => {
  if (e.target.id === 'btnSelectFile' || e.target.closest('#btnSelectFile')) return;
  const fp = await ipcRenderer.invoke('select-video');
  if (fp) loadVideo(fp);
});

async function loadVideo(videoPath) {
  state.videoPath = videoPath;
  state.confirmedPreview = false;

  const ffmpegOk = await ipcRenderer.invoke('check-ffmpeg');
  if (!ffmpegOk) {
    if (confirm('ffmpeg未找到，是否自动下载？（约80MB，需要联网）')) {
      $('#statusText').textContent = '⏳ 正在下载ffmpeg...';
      const dlRes = await ipcRenderer.invoke('ensure-ffmpeg');
      if (!dlRes.success) { $('#statusText').textContent = '❌ ' + dlRes.error; return; }
      $('#statusText').textContent = '✅ ffmpeg下载完成';
    } else { $('#statusText').textContent = '❌ 需要ffmpeg才能运行'; return; }
  }

  const info = await ipcRenderer.invoke('get-video-info', videoPath);
  if (info.error) return alert('无法读取: ' + info.error);
  $('#infoName').textContent = path.basename(videoPath);
  $('#infoRes').textContent = info.width + 'x' + info.height;
  $('#infoDuration').textContent = info.duration.toFixed(1) + 's';
  $('#infoCodec').textContent = info.codec;
  $('#videoInfo').hidden = false;

  state.projectDir = path.join(path.dirname(videoPath), 'hf-' + Date.now());
  fs.mkdirSync(state.projectDir, { recursive: true });
  $('#statusText').textContent = '⏳ 转码中...';
  const res = await ipcRenderer.invoke('transcode-to-h264', videoPath, path.join(state.projectDir, 'source.mp4'));
  if (res.error) { $('#statusText').textContent = '❌ 转码失败: ' + res.error; return; }
  await ipcRenderer.invoke('copy-fonts', state.projectDir);
  $('#statusText').textContent = '✅ 就绪';
  $('#btnGoStep2').disabled = false;
}

// ==================== Step 2: AI分析 ====================
$('#btnAnalyze').addEventListener('click', async () => {
  if (!getASRKey() && !getAIKey()) return alert('请至少填写一个API Key');

  $('#btnAnalyze').disabled = true;
  $('#btnAnalyze').textContent = '分析中...';
  $('#analysisStatus').textContent = '⏳ 分析中...';

  try {
    let transcriptText = $('#manualTranscript').value.trim();

    if (!transcriptText) {
      const asrKey = getASRKey();
      if (!asrKey) {
        $('#analysisStatus').textContent = '⚠️ 未填写语音识别Key，请粘贴文案或填写千问API Key';
        $('#btnAnalyze').disabled = false;
        $('#btnAnalyze').textContent = '开始AI分析';
        return;
      }
      $('#analysisStatus').textContent = '⏳ 提取音频...';
      const audioPath = path.join(state.projectDir, 'audio.wav');
      await ipcRenderer.invoke('extract-audio', state.videoPath, audioPath);

      $('#analysisStatus').textContent = '⏳ 云端语音识别中（千问）...';
      const cloudRes = await ipcRenderer.invoke('cloud-asr', audioPath, 'qwen', asrKey);
      if (cloudRes.error) {
        $('#analysisStatus').textContent = '⚠️ ' + cloudRes.error + ' | 也可在下方直接粘贴口播文案';
        $('#btnAnalyze').disabled = false;
        $('#btnAnalyze').textContent = '开始AI分析';
        return;
      }
      transcriptText = cloudRes.text;
    }

    $('#manualTranscript').value = transcriptText;
    $('#analysisStatus').textContent = '✅ 文案已就绪，点「确认文案，提取关键词」继续';
    $('#btnExtractKeywords').disabled = false;
  } catch (err) {
    $('#analysisStatus').textContent = '❌ ' + err.message;
  } finally {
    $('#btnAnalyze').disabled = false;
    $('#btnAnalyze').textContent = '开始AI分析';
  }
});

// 确认文案后提取关键词+特效方案
$('#btnExtractKeywords').addEventListener('click', async () => {
  const aiKey = getAIKey();
  const provider = getAIProvider();
  const transcriptText = $('#manualTranscript').value.trim();
  if (!transcriptText) return alert('请先输入或识别文案');
  if (!aiKey) return alert('请填写AI分析 API Key');

  $('#btnExtractKeywords').disabled = true;
  $('#btnExtractKeywords').textContent = '分析中...';
  $('#analysisStatus').textContent = '⏳ AI分析文案+设计特效...';

  try {
    // 提取音频用于获取时长
    const audioPath = path.join(state.projectDir, 'audio.wav');
    if (!fs.existsSync(audioPath)) {
      await ipcRenderer.invoke('extract-audio', state.videoPath, audioPath);
    }
    const vi = await ipcRenderer.invoke('get-video-info', state.videoPath);

    const prompt = `你是视频特效设计师，风格参考柱子哥。

文案：${transcriptText}

【特效规则】
1. 标签：左上角蓝色竖线 + 英文大写 + 中文
2. 大数字：金色180px，带发光阴影
3. 三层标题：英文小蓝24px + 主标题大白108px + 副标题灰28px
4. 对比卡片：BEFORE(红边框) vs NOW(绿边框)，必须用文案里的真实数据
5. 金句：左边框金色 + 深色底板 + 大字
6. 柱子图：效率/增长/百分比用chart，带GSAP width动画
7. 进度条：对比变化用progress，从旧值动画到新值
8. 颜色：蓝=概念、金=标准、红=警告、绿=正面
9. 所有特效放左侧，右侧留人脸
10. 特效不堆叠，时间错开
11. 从文案提取具体数字，禁止占位符
12. 数字用柱子图或进度条，不要用大字

输出JSON（不要markdown代码块）：
{"title":"6字标题","subtitle":"10字副标题","effects":[
  {"type":"tag","keyword":"关键词","en":"英文","zh":"中文"},
  {"type":"bignum","keyword":"关键词","num":"具体数字"},
  {"type":"compare","keyword":"关键词","before":{"val":"旧数据"},"now":{"val":"新数据"}},
  {"type":"chart","keyword":"关键词","label":"标签","pct":85},
  {"type":"progress","keyword":"关键词","label":"标签","from":20,"to":85},
  {"type":"quote","keyword":"关键词","text":"文案原话"},
  {"type":"cta","keyword":"关键词","text":"行动号召"}
]}
每个effects必须带keyword字段。直接输出JSON。`;

    const aiRes = await callAI(provider, aiKey, prompt);
    const parsed = parseJSON(aiRes);
    state.title = parsed.title || 'AI';
    state.subtitle = parsed.subtitle || '';
    state.keywords = [state.title, state.subtitle];

    const rawEffects = parsed.effects || [];
    // 特效按时间均匀分配
    const gap = vi.duration / (rawEffects.length + 1);
    state.effectsPlan = rawEffects.map((e, i) => ({ ...e, time: +(gap * (i + 1)).toFixed(1) }));
    state.effectsPlan.sort((a, b) => a.time - b.time);

    state.htmlCode = generateHTML(state.effectsPlan, vi.duration);

    $('#keywordsInput').value = [state.title, state.subtitle].join(',');
    $('#designPlan').textContent = `特效方案 (${state.effectsPlan.length}个):\n` +
      state.effectsPlan.map(e => `${e.time}s: ${e.type} - ${e.en||e.zh||e.text||e.num||''}`).join('\n');
    $('#htmlCode').value = state.htmlCode;
    $('#analysisStatus').textContent = '✅ 特效方案已生成！可修改关键词后点「重新生成」';
    $('#btnConfirmDesign').disabled = false;
    $('#btnRegenerate').disabled = false;
  } catch (err) {
    $('#analysisStatus').textContent = '❌ ' + err.message;
  } finally {
    $('#btnExtractKeywords').disabled = false;
    $('#btnExtractKeywords').textContent = '确认文案，提取关键词 →';
  }
});

$('#btnConfirmDesign').addEventListener('click', () => {
  state.htmlCode = $('#htmlCode').value || state.htmlCode;
  goStep(3);
  $('#htmlCodePreview').value = state.htmlCode;
});

// 修改关键词后重新生成
$('#btnRegenerate').addEventListener('click', async () => {
  const aiKey = getAIKey();
  const provider = getAIProvider();
  const transcriptText = $('#manualTranscript').value.trim();
  const newKeywords = $('#keywordsInput').value.trim();
  if (!transcriptText || !newKeywords) return alert('请先输入文案和关键词');
  if (!aiKey) return alert('请填写AI分析 API Key');

  $('#btnRegenerate').disabled = true;
  $('#btnRegenerate').textContent = '重新生成中...';
  $('#analysisStatus').textContent = '⏳ 根据新关键词重新设计特效...';

  try {
    const vi = await ipcRenderer.invoke('get-video-info', state.videoPath);
    const prompt = `你是视频特效设计师，风格参考柱子哥。

关键词：${newKeywords}
文案：${transcriptText}

【特效规则】
1. 标签：左上角蓝色竖线 + 英文大写 + 中文
2. 大数字：金色180px，带发光阴影
3. 对比卡片：BEFORE(红) vs NOW(绿)，用文案真实数据
4. 金句：左边框金色 + 深色底 + 大字
5. 颜色：蓝=概念、金=标准、红=警告、绿=正面
6. 所有特效放左侧，右侧留人脸
7. 特效不堆叠，时间错开
8. 关键词必须出现在特效内容中

输出JSON（不要markdown代码块）：
{"title":"6字标题","subtitle":"10字副标题","effects":[
  {"type":"tag","keyword":"关键词","en":"英文","zh":"中文"},
  {"type":"bignum","keyword":"关键词","num":"具体数字"},
  {"type":"compare","keyword":"关键词","before":{"val":"旧数据"},"now":{"val":"新数据"}},
  {"type":"chart","keyword":"关键词","label":"标签","pct":85},
  {"type":"progress","keyword":"关键词","label":"标签","from":20,"to":85},
  {"type":"quote","keyword":"关键词","text":"文案原话"},
  {"type":"cta","keyword":"关键词","text":"行动号召"}
]}
每个effects必须带keyword字段。直接输出JSON。`;

    const aiRes = await callAI(provider, aiKey, prompt);
    const parsed = parseJSON(aiRes);
    state.title = parsed.title || state.title;
    state.subtitle = parsed.subtitle || state.subtitle;

    const rawEffects = parsed.effects || [];
    const gap = vi.duration / (rawEffects.length + 1);
    state.effectsPlan = rawEffects.map((e, i) => ({ ...e, time: +(gap * (i + 1)).toFixed(1) }));
    state.effectsPlan.sort((a, b) => a.time - b.time);

    state.htmlCode = generateHTML(state.effectsPlan, vi.duration);
    $('#designPlan').textContent = `特效方案 (${state.effectsPlan.length}个):\n` +
      state.effectsPlan.map(e => `${e.time}s: ${e.type} - ${e.en||e.zh||e.text||e.num||''}`).join('\n');
    $('#htmlCode').value = state.htmlCode;
    $('#analysisStatus').textContent = '✅ 已重新生成！';
  } catch (err) {
    $('#analysisStatus').textContent = '❌ ' + err.message;
  } finally {
    $('#btnRegenerate').disabled = false;
    $('#btnRegenerate').textContent = '修改关键词后重新生成';
  }
});

// ==================== Step 3: 预览 ====================
$('#btnPreviewVideo').addEventListener('click', async () => {
  if (!state.projectDir) return;
  await ipcRenderer.invoke('write-html', path.join(state.projectDir, 'index.html'), $('#htmlCodePreview').value);
  const previewPath = path.join(state.projectDir, 'preview.mp4');
  $('#btnPreviewVideo').disabled = true;
  $('#previewStatus').textContent = '⏳ 低画质预览渲染中...';
  const res = await ipcRenderer.invoke('hyperframes-render', state.projectDir, previewPath, true);
  if (res.success) {
    const data = await ipcRenderer.invoke('read-file-base64', previewPath);
    if (data.data) {
      $('#previewVideo').src = 'data:video/mp4;base64,' + data.data;
      $('#previewVideo').hidden = false;
      $('#previewPlaceholder').hidden = true;
      $('#previewStatus').textContent = '✅ 预览已生成（低画质）';
    }
  } else {
    $('#previewStatus').textContent = '❌ ' + (res.error || '').substring(0, 200);
  }
  $('#btnPreviewVideo').disabled = false;
});

$('#btnSyncCode').addEventListener('click', () => {
  state.htmlCode = $('#htmlCodePreview').value;
  $('#previewStatus').textContent = '✅ 已同步';
});

$('#btnConfirmPreview').addEventListener('click', () => {
  state.htmlCode = $('#htmlCodePreview').value;
  state.confirmedPreview = true;
  $('[data-step="3"]').classList.add('done');
  goStep(4);
});

// ==================== Step 4: 导出 ====================
$('#btnExport').addEventListener('click', async () => {
  if (!state.projectDir || !state.htmlCode) return;
  const savePath = await ipcRenderer.invoke('select-save-path', 'output_' + Date.now() + '.mp4');
  if (!savePath) return;
  await ipcRenderer.invoke('write-html', path.join(state.projectDir, 'index.html'), state.htmlCode);
  state.outputPath = savePath;
  $('#progressArea').hidden = false;
  $('#progressFill').style.width = '20%';
  $('#progressText').textContent = '⏳ 渲染中...';
  $('#btnExport').disabled = true;
  $('#exportResult').hidden = true;

  const quality = $('#exportQuality').value;
  const fps = parseInt($('#exportFps').value) || 30;
  const res = await ipcRenderer.invoke('hyperframes-render', state.projectDir, state.outputPath, false, quality, fps);
  if (res.success) {
    try { fs.unlinkSync(path.join(state.projectDir, 'preview.mp4')); } catch(e) {}
    await ipcRenderer.invoke('cleanup-project', state.projectDir);
    $('#progressFill').style.width = '100%';
    $('#progressText').textContent = '✅ 完成!';
    $('#exportResult').hidden = false;
  } else {
    $('#progressText').textContent = '❌ ' + (res.error || '').substring(0, 200);
  }
  $('#btnExport').disabled = false;
});

$('#btnOpenFile').addEventListener('click', () => { if (state.outputPath) shell.showItemInFolder(state.outputPath); });
$('#btnCleanup').addEventListener('click', async () => {
  if (!state.projectDir) return;
  const res = await ipcRenderer.invoke('cleanup-project', state.projectDir);
  alert(res.success ? '临时文件已清理' : '清理失败: ' + res.error);
});

// ==================== HTML 生成 ====================
function generateHTML(effects, duration) {
  return state.mode === 'subtitle'
    ? generateSubtitleHTML(effects, duration)
    : generateTalkHTML(effects, duration);
}

function generateTalkHTML(effects, duration) {
  const tag = effects.find(x => x.type === 'tag');
  const tagEn = tag?.en || tag?.zh || 'KEYWORD';
  const tagZh = tag?.zh || tag?.en || '关键词';
  const titleFx = effects.find(x => x.type === 'three-layer');
  const kwEn = titleFx?.en || 'AI';
  const cmp = effects.find(x => x.type === 'compare');
  const chart = effects.find(x => x.type === 'chart' || x.type === 'bignum');
  const chartPct = chart?.pct || 85;
  const chartLabel = chart?.label || '效率提升';
  const quote = effects.find(x => x.type === 'quote');
  const quoteText = quote?.text || '金句内容';
  const cta = effects.find(x => x.type === 'cta');
  const ctaText = cta?.text || '立即行动';

  const dur = Math.max(duration, 30);
  const seg = dur / 6;
  const t1=[0.3,seg-0.5], t2=[seg,seg*2-0.5], t3=[seg*2,seg*3-0.5];
  const t4=[seg*3,seg*4-0.5], t5=[seg*4,seg*5-0.5], t6=[seg*5,Math.min(seg*6,dur)];

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@font-face{font-family:'Noto Sans SC';src:url('fonts/NotoSansSC-Regular.ttf')}
@font-face{font-family:'Noto Sans SC';src:url('fonts/NotoSansSC-Bold.ttf');font-weight:700}
@font-face{font-family:'Noto Sans SC';src:url('fonts/NotoSansSC-Black.ttf');font-weight:900}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1080px;background:#000;overflow:hidden;font-family:'Noto Sans SC',sans-serif}
.video-bg{position:absolute;top:0;left:0;width:1920px;height:1080px;object-fit:cover;z-index:1}
.overlay{position:absolute;top:0;left:0;width:960px;height:1080px;background:linear-gradient(90deg,rgba(0,0,0,0.85),rgba(0,0,0,0.5),rgba(0,0,0,0));z-index:2;opacity:0}
.fx{position:absolute;top:0;left:0;width:960px;height:1080px;z-index:10}
.tag{position:absolute;top:80px;left:80px;display:flex;align-items:center;gap:16px;opacity:0}
.tag-line{width:4px;height:52px;background:#3B82F6;border-radius:2px}
.tag .en{font-size:22px;font-weight:700;color:#3B82F6;letter-spacing:4px;text-transform:uppercase}
.tag .zh{font-size:18px;color:rgba(255,255,255,0.6);margin-top:3px}
.big-title{position:absolute;top:160px;left:80px;opacity:0}
.big-title .en-sub{font-size:24px;font-weight:700;color:#3B82F6;letter-spacing:3px}
.big-title .main{font-size:108px;font-weight:900;color:#fff;line-height:1.1;margin:8px 0}
.big-title .zh-sub{font-size:28px;color:rgba(255,255,255,0.5)}
.compare{position:absolute;top:200px;left:80px;display:flex;gap:36px;opacity:0}
.compare-card{background:rgba(255,255,255,0.06);border-radius:16px;padding:36px 44px;min-width:300px;border:1px solid rgba(255,255,255,0.08)}
.compare-card.before{border-left:4px solid #EF4444}
.compare-card.now{border-left:4px solid #22C55E}
.compare-label{font-size:18px;font-weight:700;letter-spacing:3px;text-transform:uppercase;margin-bottom:12px}
.compare-card.before .compare-label{color:#EF4444}
.compare-card.now .compare-label{color:#22C55E}
.compare-val{font-size:72px;font-weight:900;color:#fff;line-height:1}
.chart-wrap{position:absolute;top:240px;left:80px;width:650px;opacity:0}
.chart-title{font-size:22px;color:rgba(255,255,255,0.5);margin-bottom:16px}
.chart-bar{width:100%;height:64px;background:rgba(255,255,255,0.06);border-radius:12px;overflow:hidden}
.chart-fill{height:100%;background:linear-gradient(90deg,#22C55E,#4ADE80);border-radius:12px;width:0%}
.quote-card{position:absolute;top:280px;left:80px;padding:36px 44px;max-width:680px;border-left:5px solid #F59E0B;background:rgba(0,0,0,0.5);border-radius:0 14px 14px 0;opacity:0}
.quote-text{font-size:42px;font-weight:900;color:#fff;line-height:1.4}
.cta-wrap{position:absolute;top:50%;left:80px;transform:translateY(-50%);opacity:0}
.cta-big{font-size:96px;font-weight:900;color:#F59E0B}
.cta-sub{font-size:28px;color:rgba(255,255,255,0.5);margin-top:10px}
</style></head><body>
<div data-composition-id="root" data-start="0" data-duration="${dur}" data-width="1920" data-height="1080">
<video class="video-bg clip" id="main-video" src="source.mp4" data-start="0" data-duration="${dur}" autoplay muted loop></video>
<audio id="main-audio" src="audio.wav" data-start="0" data-duration="${dur}" data-track-index="0" data-volume="1"></audio>
<div class="overlay clip" id="ov" data-start="0" data-duration="${dur}"></div>
<div class="fx clip" data-start="0" data-duration="${dur}">
  <div class="tag clip" id="e1a" data-start="${t1[0]}" data-duration="${t1[1]-t1[0]}">
    <div class="tag-line"></div><div><div class="en">${tagEn}</div><div class="zh">${tagZh}</div></div>
  </div>
  <div class="big-title clip" id="e2" data-start="${t2[0]}" data-duration="${t2[1]-t2[0]}">
    <div class="en-sub">${kwEn}</div><div class="main">${state.title||'标题'}</div><div class="zh-sub">${state.subtitle||''}</div>
  </div>
  <div class="compare clip" id="e3" data-start="${t3[0]}" data-duration="${t3[1]-t3[0]}">
    <div class="compare-card before"><div class="compare-label">BEFORE</div><div class="compare-val">${cmp?.before?.val||'旧'}</div></div>
    <div class="compare-card now"><div class="compare-label">NOW</div><div class="compare-val">${cmp?.now?.val||'新'}</div></div>
  </div>
  <div class="chart-wrap clip" id="e4" data-start="${t4[0]}" data-duration="${t4[1]-t4[0]}">
    <div class="chart-title">${chartLabel}</div><div class="chart-bar"><div class="chart-fill" id="bar1"></div></div>
  </div>
  <div class="quote-card clip" id="e5" data-start="${t5[0]}" data-duration="${t5[1]-t5[0]}">
    <div class="quote-text">${quoteText}</div>
  </div>
  <div class="cta-wrap clip" id="e6" data-start="${t6[0]}" data-duration="${t6[1]-t6[0]}">
    <div class="cta-big">${ctaText}</div><div class="cta-sub">用AI改变工作方式</div>
  </div>
</div></div>
<script src="gsap.min.js"></script>
<script>
window.__timelines={};const tl=gsap.timeline();window.__timelines["root"]=tl;
tl.to('#ov',{opacity:1,duration:0.5,overwrite:"auto"},${t1[0]});
tl.fromTo('#e1a',{opacity:0,x:-30},{opacity:1,x:0,duration:0.6,ease:'power3.out',overwrite:"auto"},${t1[0]});
tl.to('#e1a',{opacity:0,duration:0.4,overwrite:"auto"},${t1[1]});
tl.to('#ov',{opacity:0,duration:0.4,overwrite:"auto"},${t1[1]});
tl.to('#ov',{opacity:1,duration:0.4,overwrite:"auto"},${t2[0]});
tl.fromTo('#e2',{opacity:0,y:30},{opacity:1,y:0,duration:0.7,ease:'power3.out',overwrite:"auto"},${t2[0]});
tl.to('#e2',{opacity:0,duration:0.4,overwrite:"auto"},${t2[1]});
tl.to('#ov',{opacity:0,duration:0.4,overwrite:"auto"},${t2[1]});
tl.to('#ov',{opacity:1,duration:0.4,overwrite:"auto"},${t3[0]});
tl.fromTo('#e3',{opacity:0,y:30},{opacity:1,y:0,duration:0.6,ease:'power3.out',overwrite:"auto"},${t3[0]});
tl.to('#e3',{opacity:0,duration:0.4,overwrite:"auto"},${t3[1]});
tl.to('#ov',{opacity:0,duration:0.4,overwrite:"auto"},${t3[1]});
tl.to('#ov',{opacity:1,duration:0.4,overwrite:"auto"},${t4[0]});
tl.fromTo('#e4',{opacity:0,y:30},{opacity:1,y:0,duration:0.6,ease:'power3.out',overwrite:"auto"},${t4[0]});
tl.to('#bar1',{width:'${chartPct}%',duration:1.2,ease:'power2.out',overwrite:"auto"},${t4[0]});
tl.to('#e4',{opacity:0,duration:0.4,overwrite:"auto"},${t4[1]});
tl.to('#ov',{opacity:0,duration:0.4,overwrite:"auto"},${t4[1]});
tl.to('#ov',{opacity:1,duration:0.4,overwrite:"auto"},${t5[0]});
tl.fromTo('#e5',{opacity:0,x:-40},{opacity:1,x:0,duration:0.7,ease:'power3.out',overwrite:"auto"},${t5[0]});
tl.to('#e5',{opacity:0,duration:0.4,overwrite:"auto"},${t5[1]});
tl.to('#ov',{opacity:0,duration:0.4,overwrite:"auto"},${t5[1]});
tl.to('#ov',{opacity:1,duration:0.4,overwrite:"auto"},${t6[0]});
tl.fromTo('#e6',{opacity:0,scale:0.7},{opacity:1,scale:1,duration:0.8,ease:'back.out(1.5)',overwrite:"auto"},${t6[0]});
</script></body></html>`;
}

function generateSubtitleHTML(effects, duration) {
  const transcriptText = $('#manualTranscript')?.value?.trim() || '';
  const dur = Math.max(duration, 30);
  const sentences = transcriptText.split(/[。！？\n]+/).filter(s => s.trim());
  const tps = dur / (sentences.length + 1);
  const segs = sentences.map((text, i) => ({
    text: text.trim(), start: +(tps * (i + 0.5)).toFixed(2), end: +(tps * (i + 1.5)).toFixed(2)
  }));

  let subsHTML = '', subsAnim = '';
  segs.forEach((s, i) => {
    subsHTML += `<div class="sub clip" id="sub${i}" data-start="${s.start}" data-duration="${s.end-s.start}">${s.text}</div>\n`;
    subsAnim += `tl.fromTo('#sub${i}',{opacity:0,y:10},{opacity:1,y:0,duration:0.2,overwrite:"auto"},${s.start});tl.to('#sub${i}',{opacity:0,duration:0.15,overwrite:"auto"},${s.end-0.15});\n`;
  });

  let fxHTML = '', fxAnim = '';
  effects.forEach((e, i) => {
    const t = e.time || (i * 3);
    const end = Math.min(t + 2.5, dur);
    const label = e.keyword || e.en || e.zh || e.text || e.num || '';
    fxHTML += `<div class="kw-fx clip" id="kw${i}" data-start="${t}" data-duration="${end-t}"><div class="kw-tag">${label}</div></div>\n`;
    fxAnim += `tl.fromTo('#kw${i}',{opacity:0,x:-20},{opacity:1,x:0,duration:0.4,overwrite:"auto"},${t});tl.to('#kw${i}',{opacity:0,duration:0.3,overwrite:"auto"},${end-0.3});\n`;
  });

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><style>
@font-face{font-family:'Noto Sans SC';src:url('fonts/NotoSansSC-Regular.ttf')}
@font-face{font-family:'Noto Sans SC';src:url('fonts/NotoSansSC-Bold.ttf');font-weight:700}
@font-face{font-family:'Noto Sans SC';src:url('fonts/NotoSansSC-Black.ttf');font-weight:900}
*{margin:0;padding:0;box-sizing:border-box}
body{width:1920px;height:1080px;background:#000;overflow:hidden;font-family:'Noto Sans SC',sans-serif}
.video-bg{position:absolute;top:0;left:0;width:1920px;height:1080px;object-fit:cover;z-index:1}
.sub{position:absolute;bottom:120px;left:50%;transform:translateX(-50%);z-index:20;font-size:42px;font-weight:700;color:#fff;text-shadow:2px 2px 8px rgba(0,0,0,0.9),0 0 20px rgba(0,0,0,0.5);opacity:0;text-align:center;max-width:1400px;line-height:1.4}
.kw-fx{position:absolute;top:80px;left:80px;z-index:15;opacity:0}
.kw-tag{background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#F59E0B;padding:10px 24px;border-radius:24px;font-size:24px;font-weight:700;display:inline-block}
</style></head><body>
<div data-composition-id="root" data-start="0" data-duration="${dur}" data-width="1920" data-height="1080">
<video class="video-bg clip" id="main-video" src="source.mp4" data-start="0" data-duration="${dur}" autoplay muted loop></video>
<audio id="main-audio" src="audio.wav" data-start="0" data-duration="${dur}" data-track-index="0" data-volume="1"></audio>
${subsHTML}${fxHTML}</div>
<script src="gsap.min.js"></script>
<script>
window.__timelines={};const tl=gsap.timeline();window.__timelines["root"]=tl;
${subsAnim}${fxAnim}</script></body></html>`;
}

// ==================== AI 调用 ====================
function parseJSON(text) {
  try {
    let c = text.replace(/```json\s*/g, '').replace(/```\s*/g, '');
    c = c.replace(/<think>[\s\S]*?<\/think>/g, '');
    const m = c.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : {};
  } catch { return {}; }
}

async function callAI(provider, apiKey, prompt) {
  apiKey = apiKey.replace(/[^\x00-\x7F]/g, '').trim();
  let url = provider === 'deepseek'
    ? 'https://api.deepseek.com/chat/completions'
    : 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
  const model = provider === 'deepseek' ? 'deepseek-chat' : 'qwen-plus';
  const headers = { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' };
  const body = JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], temperature: 0.7, max_tokens: 2048 });

  const resp = await fetch(url, { method: 'POST', headers, body });
  if (!resp.ok) {
    const errData = await resp.json().catch(() => ({}));
    throw new Error(errData.error?.message || `API请求失败 (${resp.status})`);
  }
  const data = await resp.json();
  if (!data.choices || !data.choices[0]) throw new Error('API返回数据异常');
  return data.choices[0].message.content;
}

// ==================== 启动 ====================
(async function() {
  ipcRenderer.on('ffmpeg-download-progress', (event, msg) => {
    const el = $('#statusText'); if (el) el.textContent = '⏳ ' + msg;
  });
  ipcRenderer.on('auto-download-ffmpeg', async () => {
    if (!confirm('ffmpeg未找到，是否自动下载？（约80MB，需要联网）')) return;
    $('#statusText').textContent = '⏳ 正在下载ffmpeg...';
    const res = await ipcRenderer.invoke('ensure-ffmpeg');
    $('#statusText').textContent = res.success ? '✅ ffmpeg下载完成' : '❌ ' + res.error;
  });
})();
