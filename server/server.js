/**
 * ================================================================
 *  个人主页的小后端：给网页提供两个 AI 功能
 * ================================================================
 *  为什么需要它：
 *    Replicate / OpenRouter 的接口不能直接在浏览器里调用，API Key 也
 *    绝对不能写进网页源码（任何人查看源代码就能拿走）。所以由这个
 *    Node.js 服务在后台拿着 Key 去调模型，再把结果发回给网页。
 *
 *  它做了什么：
 *    1) 把项目根目录的 index.html / imagine.html / avatar.jpg 当作静态页面发出去
 *    2) POST /api/remove-bg       接收网页上传的图片 → 调 Replicate → 返回透明底 PNG
 *    3) POST /api/generate-image  接收一段文字描述 → 调 OpenRouter → 返回生成的图片
 *    4) GET  /api/health          给网页一个「后端在不在、Key 配没配」的小体检
 *
 *  用到的模型：
 *    · 抠图      lucataco/remove-bg            （Replicate）
 *    · 文字生图  openai/gpt-5.4-image-2        （OpenRouter）
 *  启动方式见项目根目录的 README.md
 * ================================================================
 */
'use strict';

/* 读取 server/.env 里的环境变量（REPLICATE_API_TOKEN 就从这里来） */
require('dotenv').config();

const path = require('node:path');
const express = require('express');
const multer = require('multer');
const Replicate = require('replicate');

/* ---------------- 配置：都能用环境变量覆盖 ---------------- */
const PORT = Number(process.env.PORT || 3000);
const ROOT = path.resolve(__dirname, '..');                                 /* 静态页面（index.html）所在目录 */
const MODEL = process.env.REPLICATE_MODEL || 'lucataco/remove-bg';          /* 换模型只改这里 / 或 .env */
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 10);                     /* 允许上传的最大体积 */
const MAX_BYTES = Math.round(MAX_MB * 1024 * 1024);

/* ---------- 第四屏「文字生成图片」（OpenRouter）的配置 ---------- */
const IMAGE_MODEL = process.env.OPENROUTER_IMAGE_MODEL || 'openai/gpt-5.4-image-2';
const OPENROUTER_URL = process.env.OPENROUTER_IMAGE_URL || 'https://openrouter.ai/api/v1/images';
const IMAGE_TIMEOUT_MS = Number(process.env.OPENROUTER_TIMEOUT_SEC || 240) * 1000;  /* 生图偏慢，默认给 4 分钟 */
const MAX_PROMPT = 2000;                                                     /* 描述最多多少字 */

/* 能选的比例（取自 OpenRouter「Generate an image」接口文档里的 aspect_ratio 枚举，挑常用的） */
const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '4:5', '5:4', '21:9'];

const ALLOWED_TYPES = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/gif', 'image/bmp', 'image/tiff', 'image/avif',
];

/* Token 只从环境变量读，不写死在代码里 */
const hasToken = Boolean(process.env.REPLICATE_API_TOKEN);
const hasOpenrouterKey = Boolean(process.env.OPENROUTER_API_KEY);   /* 文字生成图片用的 Key */
const replicate = new Replicate();   /* 不传参数时，SDK 自动读取 process.env.REPLICATE_API_TOKEN */

/* ---------------- 模型标识：解析成「模型名:版本号」 ----------------
   为什么必须带上版本号：
     只给 owner/name 时，SDK 会去请求 POST /v1/models/{owner}/{name}/predictions，
     而这个接口对社区模型会返回 404；
     明确给出「owner/name:版本号」时，SDK 走的是 POST /v1/predictions —— 这条才是通用可用的。
   所以这里的策略是：.env 里写了版本号就用写的；没写就自动查一次最新版本，并缓存起来。
   ------------------------------------------------------------------ */
let resolvedIdentifier = null;

async function resolveIdentifier() {
  if (resolvedIdentifier) return resolvedIdentifier;

  if (MODEL.includes(':')) {                 /* 已经是 owner/name:版本号，直接用 */
    resolvedIdentifier = MODEL;
    return resolvedIdentifier;
  }

  const [owner, name] = MODEL.split('/');
  if (owner && name) {
    try {
      const info = await replicate.models.get(owner, name);
      const version = info && info.latest_version && info.latest_version.id;
      resolvedIdentifier = version
        ? `${info.owner || owner}/${info.name || name}:${version}`
        : MODEL;
      return resolvedIdentifier;
    } catch (err) {
      console.warn(`[模型] 没能查到 ${MODEL} 的最新版本（${err.message}），先按模型名直接调用`);
    }
  }

  resolvedIdentifier = MODEL;
  return resolvedIdentifier;
}

/* ---------------- 小工具 ---------------- */
class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* 让 async 路由里抛出的错误也能被下面的错误处理中间件接住 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* 把内存里的图片转成 Replicate 认识的文件对象（SDK 会自动上传它） */
function toReplicateFile(file) {
  const FileCtor = typeof File === 'function' ? File : require('node:buffer').File;
  const safeName = String(file.originalname || 'image.png').replace(/[\\/:*?"<>|]/g, '_') || 'image.png';
  return new FileCtor([file.buffer], safeName, { type: file.mimetype || 'image/png' });
}

/* 模型的输出统一读成 Buffer：新版 SDK 返回的是 FileOutput（可 .blob()，也可 .url()） */
async function readOutputAsBuffer(output) {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first) throw new HttpError(502, '模型没有返回图片，请换一张再试');

  if (typeof first.blob === 'function') {                 /* FileOutput：推荐方式 */
    const blob = await first.blob();
    return Buffer.from(await blob.arrayBuffer());
  }
  if (typeof first.url === 'function') {                  /* 有些情况只能拿到 url() */
    const res = await fetch(String(first.url()));
    if (!res.ok) throw new HttpError(502, `下载结果失败（HTTP ${res.status}）`);
    return Buffer.from(await res.arrayBuffer());
  }
  if (typeof first === 'string') {                        /* 极少数模型直接返回字符串 URL */
    const res = await fetch(first);
    if (!res.ok) throw new HttpError(502, `下载结果失败（HTTP ${res.status}）`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new HttpError(502, '无法识别模型返回的结果格式');
}

/* ---------------- 应用本体 ---------------- */
const app = express();
app.disable('x-powered-by');

/* 让 /api/generate-image 能直接读 JSON 请求体（只发一段文字，限 64KB 足够） */
app.use(express.json({ limit: '64kb' }));

/* 图片先进内存，不落盘：避免在电脑上留下临时文件 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter(req, file, cb) {
    if (!ALLOWED_TYPES.includes(String(file.mimetype).toLowerCase())) {
      cb(new HttpError(415, '只支持图片文件（JPG / PNG / WEBP / GIF / BMP / TIFF / AVIF）'));
      return;
    }
    cb(null, true);
  },
});

/* ---------- 1) 静态页面 ---------- */
app.get('/', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(ROOT, 'index.html')));
app.get('/avatar.jpg', (req, res) => res.sendFile(path.join(ROOT, 'avatar.jpg')));
app.get('/imagine.html', (req, res) => res.sendFile(path.join(ROOT, 'imagine.html')));   /* 文字生成图片 */
app.get('/imagine', (req, res) => res.sendFile(path.join(ROOT, 'imagine.html')));        /* 好看一点的短地址 */

/* ---------- 2) 小体检：网页靠它判断后端有没有起来 ---------- */
app.get('/api/health', asyncHandler(async (req, res) => {
  res.json({
    ok: true,
    model: await resolveIdentifier(),
    hasToken: hasToken,
    maxUploadMB: MAX_MB,
    imageModel: IMAGE_MODEL,              /* 文字生成图片用的模型 */
    hasOpenrouterKey: hasOpenrouterKey,   /* 那个 Key 配好了没 */
  });
}));

/* ---------- 3) 去背景：核心接口 ---------- */
app.post('/api/remove-bg', upload.single('image'), asyncHandler(async (req, res) => {
  const file = req.file;

  if (!file || !file.buffer || !file.buffer.length) {
    throw new HttpError(400, '没有收到图片，请重新选择一张');
  }
  if (!process.env.REPLICATE_API_TOKEN) {
    throw new HttpError(500, '服务器没有配置 REPLICATE_API_TOKEN：请把 server/.env.example 复制成 server/.env，'
      + '填入你的 Token 后重启服务（获取地址 https://replicate.com/account/api-tokens）');
  }

  const startedAt = Date.now();

  /* 带上版本号的模型标识（只给模型名时 Replicate 会 404，见上面的说明） */
  const identifier = await resolveIdentifier();

  console.log(`[抠图] 收到「${file.originalname}」（${(file.size / 1024).toFixed(0)} KB），开始调用 ${identifier} …`);

  /* replicate.run() 会自动创建任务并等到图片生成完再把结果给你 */
  const output = await replicate.run(identifier, {
    input: { image: toReplicateFile(file) },
  });

  const buffer = await readOutputAsBuffer(output);
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`[抠图] 成功，用时 ${seconds}s，结果 ${(buffer.length / 1024).toFixed(0)} KB`);

  /* 直接以 data URL 返回，网页拿到就能立刻显示 / 下载（模型给的链接一小时内会过期） */
  res.json({
    ok: true,
    image: 'data:image/png;base64,' + buffer.toString('base64'),
    bytes: buffer.length,
    seconds: Number(seconds),
    model: identifier,
  });
}));

/* ---------- 4) 文字生成图片：核心接口（网页 imagine.html 用） ----------
   请求：POST /api/generate-image   JSON  { prompt, aspect_ratio }
   返回：{ ok, image: <data URL>, model, aspectRatio, seconds, cost }
   和抠图一样，Key 只在服务端用，网页里看不到
   ------------------------------------------------------------------ */
app.post('/api/generate-image', asyncHandler(async (req, res) => {
  const body = req.body || {};

  if (!process.env.OPENROUTER_API_KEY) {
    throw new HttpError(500, '服务器没有配置 OPENROUTER_API_KEY：请把 server/.env.example 复制成 server/.env，'
      + '填入你的 Key 后重启服务（获取地址 https://openrouter.ai/keys）');
  }

  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  if (!prompt) {
    throw new HttpError(400, '请先写一段描述，再点「生成图片」');
  }
  if (prompt.length > MAX_PROMPT) {
    throw new HttpError(400, `描述太长了，请控制在 ${MAX_PROMPT} 个字以内`);
  }

  /* 比例只在白名单里选，防止乱传 */
  const aspectRatio = ASPECT_RATIOS.includes(String(body.aspect_ratio)) ? String(body.aspect_ratio) : '1:1';
  const startedAt = Date.now();

  const shortPrompt = prompt.slice(0, 40) + (prompt.length > 40 ? '…' : '');
  console.log(`[生图] 「${shortPrompt}」比例 ${aspectRatio}，开始调用 ${IMAGE_MODEL} …`);

  /* 自己控制超时：生图可能比较慢，默认给 4 分钟 */
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), IMAGE_TIMEOUT_MS);

  let resp;
  try {
    resp = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + process.env.OPENROUTER_API_KEY,
        'Content-Type': 'application/json',
        /* 下面两个是 OpenRouter 可选的来源标识，不填也能用。
           注意：HTTP 头只能放英文/数字（latin-1），写中文会让 fetch 直接报错 */
        'HTTP-Referer': `http://localhost:${PORT}`,
        'X-Title': 'Personal Homepage - Text to Image',
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt: prompt,
        aspect_ratio: aspectRatio,
        output_format: 'png',
      }),
      signal: ac.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new HttpError(504, `等太久了（超过 ${IMAGE_TIMEOUT_MS / 1000} 秒）模型还没出图，请稍后再试`);
    }
    /* 把原始错误打到终端，方便排查（比如 DNS 不通、代理、请求头不合法） */
    console.error('[生图] 请求 OpenRouter 失败：', err && err.message ? err.message : err);
    throw new HttpError(502, '连不上 OpenRouter：请检查电脑网络后重试'
      + (err && err.message ? `（${err.message}）` : ''));
  } finally {
    clearTimeout(timer);
  }

  const payload = await resp.json().catch(() => null);

  if (!resp.ok) {
    const detail = (payload && payload.error && payload.error.message) || `HTTP ${resp.status}`;
    if (resp.status === 401 || resp.status === 403) {
      throw new HttpError(401, `OpenRouter 拒绝了这次请求（${detail}）：请检查 server/.env 里的 OPENROUTER_API_KEY 是否正确、有没有过期`);
    }
    if (resp.status === 402) {
      throw new HttpError(402, 'OpenRouter 账户额度不足，请先充值：https://openrouter.ai/credits');
    }
    if (resp.status === 429) {
      throw new HttpError(429, '请求太频繁了，歇几秒再试');
    }
    if (resp.status === 400) {
      throw new HttpError(400, `参数被拒绝了（${detail}）：可以换个描述再试`);
    }
    throw new HttpError(502, `OpenRouter 出错了（${detail}）`);
  }

  /* 官方返回格式：{ created, data: [{ b64_json, media_type }], usage }
     图片是 base64 裸数据，这里拼成 data URL 给网页直接显示 */
  const first = payload && Array.isArray(payload.data) ? payload.data[0] : null;
  if (!first || !first.b64_json) {
    throw new HttpError(502, '模型这次没有返回图片，换个描述再试一次');
  }

  const mime = String(first.media_type || 'image/png');
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const cost = payload.usage && typeof payload.usage.cost === 'number' ? payload.usage.cost : null;

  console.log(`[生图] 成功，用时 ${seconds}s，` + (cost === null ? '（未返回费用）' : `本次花费 $${cost}`));

  res.json({
    ok: true,
    image: `data:${mime};base64,` + first.b64_json,
    model: IMAGE_MODEL,
    aspectRatio: aspectRatio,
    seconds: Number(seconds),
    cost: cost,
  });
}));

/* ---------- 5) 兜底：404 与统一错误格式 ---------- */
app.use((req, res) => {
  res.status(404).json({ ok: false, error: '没有这个地址：' + req.path });
});

app.use((err, req, res, next) => {   /* eslint-disable-line no-unused-vars */
  let status = err.status || 500;
  let message = err.message || '服务器出错了，请稍后再试';

  if (err.code === 'LIMIT_FILE_SIZE') {
    status = 413;
    message = `图片太大了，请压缩到 ${MAX_MB}MB 以内再上传`;
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    status = 400;
    message = '上传字段不对：文件要用 image 这个字段名';
  } else if (/401|unauthor|authenticat|invalid token/i.test(String(err.message || ''))) {
    status = 401;
    message = 'Replicate 拒绝了这次请求：API Token 可能无效或已过期，请检查 server/.env 里的 REPLICATE_API_TOKEN';
  } else if (/402|payment|billing|insufficient/i.test(String(err.message || ''))) {
    status = 402;
    message = 'Replicate 账户额度不足或未绑定支付方式（免费额度用完后需要充值）';
  }

  if (status >= 500) console.error('[抠图失败]', err);

  res.status(status).json({ ok: false, error: message });
});

/* ---------------- 启动 ---------------- */
app.listen(PORT, () => {
  console.log('');
  console.log('  ┌───────────────────────────────────────────────┐');
  console.log('  │   个人主页已启动                              │');
  console.log('  └───────────────────────────────────────────────┘');
  console.log(`  打开网址：  http://localhost:${PORT}`);
  console.log(`  抠图模型：  ${MODEL}${MODEL.includes(':') ? '' : '（首次调用时自动解析到最新版本）'}`);
  console.log(`  Token：     ${hasToken ? '已读取到 REPLICATE_API_TOKEN ✓' : '✗ 未配置（抠图会失败，请看 README）'}`);
  console.log(`  生图模型：  ${IMAGE_MODEL}（页面：http://localhost:${PORT}/imagine）`);
  console.log(`  生图 Key：  ${hasOpenrouterKey ? '已读取到 OPENROUTER_API_KEY ✓' : '✗ 未配置（文字生图会失败，请看 README）'}`);
  console.log(`  大小上限：  ${MAX_MB} MB`);
  console.log('');
});
