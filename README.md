# 个人主页 · 两个 AI 小功能（一键去背景 / 文字生成图片）

一个小巧的全栈 Demo：前端是**单个 HTML 文件**的个人主页，外加一个独立的「文字生图」页面，后端是一个 Node.js + Express 的小服务。

| 功能 | 在哪 | 用的模型 | 页面地址 |
| --- | --- | --- | --- |
| 一键去除图片背景 | 主页第三屏 | Replicate 的 [`lucataco/remove-bg`](https://replicate.com/lucataco/remove-bg) | <http://localhost:3000> |
| 文字生成图片 | 独立页面（谷歌极简风） | OpenRouter 的 [`openai/gpt-5.4-image-2`](https://openrouter.ai/openai/gpt-5.4-image-2/api) | <http://localhost:3000/imagine> |

抠图走 Replicate 官方 SDK 的 `replicate.run()`（它会一直等到图片生成完再把结果给你）；文字生图走后端的 `POST /api/generate-image`，由后端代你调 OpenRouter。

---

## 为什么需要后端？

**两个 AI 接口都不能直接在浏览器里调用**：一是官方 SDK 只能在服务端跑，二是 API Key 一旦写进网页源码，任何人「查看源代码」就能拿走并盗用你的额度（浏览器直连还会撞上跨域限制）。

所以这里的结构是：

```
浏览器  --上传图片 / 一段文字-->  本机 Express 后端  --带 Key 调模型-->  Replicate / OpenRouter
   ^                                    |
   └-------- 返回 base64 图片（data URL） ┘
```

两个 Key 都只存在于后端进程的环境变量里，网页源码中看不到它们。

---

## 目录结构

```
20260929人工智能课/
├── index.html              # 前端：主页（三屏，零外部依赖、零 CDN）
├── imagine.html            # 前端：文字生成图片页面（谷歌极简风，独立一页）
├── avatar.jpg              # 第一屏的圆形头像
├── README.md               # 就是本文件
└── server/                 # 后端
    ├── server.js           # Express 服务：静态页面 + 抠图接口 + 文字生图接口
    ├── package.json        # 依赖与启动命令
    ├── .env.example        # 环境变量模板（复制成 .env 后填两个 Key）
    └── .gitignore          # 忽略 node_modules 和 .env
```

---

## 快速开始（三步）

### 0. 先确认 Node 版本

需要 **Node.js 18.17 或更高**（`replicate` SDK 的要求，官方 SDK 也依赖 Node 内置的 `fetch`）。

```powershell
node -v
```

### 1. 配置两个 API Key

**① Replicate（抠图用）**：去 <https://replicate.com/account/api-tokens> 注册 / 登录后创建一个 Token（形如 `r8_xxxxxxxx`）。

**② OpenRouter（文字生图用）**：去 <https://openrouter.ai/keys> 注册 / 登录后创建一个 Key（形如 `sk-or-v1-xxxxxxxx`）。文字生图是**按用量付费**的，先在 <https://openrouter.ai/credits> 充一点额度，否则接口会返回「额度不足」。

两个 Key 都要填。然后在 `server` 目录里，把模板复制成真正的配置文件：

```powershell
cd server
Copy-Item .env.example .env
```

打开 `server/.env`，把两个 Key 填进去：

```ini
REPLICATE_API_TOKEN=r8_你的Replicate Token
OPENROUTER_API_KEY=sk-or-v1-你的OpenRouter Key
```

> `.env` 已被 `.gitignore` 忽略，不会被提交；**不要**把 Key 写进任何 `.html` 或 `server.js`。

### 2. 安装依赖并启动

```powershell
cd server
npm install
npm start
```

看到这样的提示就成功了（两个 Key 都读到才算齐）：

```
  打开网址：  http://localhost:3000
  抠图模型：  lucataco/remove-bg（首次调用时自动解析到最新版本）
  Token：     已读取到 REPLICATE_API_TOKEN ✓
  生图模型：  openai/gpt-5.4-image-2（页面：http://localhost:3000/imagine）
  生图 Key：  已读取到 OPENROUTER_API_KEY ✓
  大小上限：  10 MB
```

### 3. 打开网页

**一定要通过 `http://localhost:3000` 打开**（而不是双击 `index.html`）：

- 主页（含抠图）：<http://localhost:3000>
- 文字生图：<http://localhost:3000/imagine>（主页右上角导航的「文字生图」也能进）

这样网页和后端是同一个来源，浏览器的同源策略不会拦请求。

> 直接双击打开 `index.html` / `imagine.html` 时：天气功能照常可用，但点「去除背景」「生成图片」都会提示「连不上后端」，这是正常的。

---

## 怎么用

### ① 一键去除图片背景（主页第三屏）

1. 滚到第三屏「一键去除图片背景」。
2. 把图片**拖进虚线框**，或者**点一下虚线框**从电脑里选一张（也支持键盘：`Tab` 聚焦后按回车或空格）。
3. 左侧立刻显示原图预览。
4. 点「**去除背景**」。按钮会变灰，文字变成「**处理中…**」，并带一个转圈动画；通常 5～20 秒。
5. 右侧出现透明底结果，背景是棋盘格（故意画的，用来显示透明区域）。
6. 点「**下载 PNG**」保存；点「**换一张**」重新开始。

支持的格式：JPG / PNG / WEBP / GIF / BMP / TIFF / AVIF，单张不超过 **10MB**。

### ② 文字生成图片（`/imagine`）

1. 在中间的输入框里用中文或英文描述你想要的画面，比如「一只戴着宇航头盔的橘猫，漂浮在星云里，电影感光线」。
2. 想省事的话，点下面「试试这些」里的灵感标签，会直接把描述填进输入框。
3. 选一个画面比例（1:1 方形 / 16:9 宽屏 / 9:16 手机竖屏 …），不选就是 1:1。
4. 点「**生成图片**」。按钮变成「**中止**」，下方出现一张骨架屏卡片，卡片上会实时显示「正在作画，已等待 N 秒…」。通常 **15～25 秒**。
5. 出图后，结果卡片下方标注了「比例 · 耗时 · 花费」（例如 `16:9 · 18.4s · $0.0039`），并提供三个操作：
   - **下载 PNG**：存到本地。
   - **复制描述**：把这次的提示词复制回剪贴板，方便微调后重画。
   - **再画一张**：用同一段描述再生成一张，一张张往下叠（页面最多保留 12 张，超出会自动删掉最旧的，避免吃内存）。
6. 生成过程中点「**中止**」可以取消这次请求，不会产生新的调用费用。

小技巧：描述里写得越具体（主体 + 动作 + 环境 + 光线 + 画风 + 画质词），效果越稳定；回车是「开始生成」，`Shift + 回车` 是换行。

---

## 接口说明

### `GET /api/health`

一个「后端在不在、Token 配没配」的小体检。

```json
{
  "ok": true,
  "model": "lucataco/remove-bg:95fcc2a2…befaf1",
  "hasToken": true,
  "maxUploadMB": 10,
  "imageModel": "openai/gpt-5.4-image-2",
  "hasOpenrouterKey": true
}
```

网页（尤其是 `/imagine`）启动时会自动调它：用来回填模型名、判断 Key 配没配、判断后端通不通。

### `POST /api/remove-bg`

抠图主接口，`multipart/form-data`，文件字段名必须是 **`image`**。

成功：

```json
{
  "ok": true,
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "bytes": 183920,
  "seconds": 8.4,
  "model": "lucataco/remove-bg:95fcc2a2…befaf1"
}
```

失败（HTTP 状态码 + 中文原因）：

```json
{ "ok": false, "error": "只支持图片文件（JPG / PNG / WEBP / GIF / BMP / TIFF / AVIF）" }
```

| 状态码 | 含义 |
| --- | --- |
| 400 | 没收到图片，或上传字段名不是 `image` |
| 401 | Replicate 拒绝了请求：Token 无效 / 已过期 |
| 402 | Replicate 账户额度不足或未绑定支付方式 |
| 413 | 图片超过大小上限 |
| 415 | 上传的不是图片 |
| 500 | 服务器没配置 `REPLICATE_API_TOKEN` |
| 502 | 模型没返回结果，或下载结果失败 |
| 404 | 地址不存在 |

为什么结果要以 base64 回传？因为 Replicate 给的输出链接**大约 1 小时就会过期**，转成 data URL 交给网页后，用户随时都能下载，不依赖那个临时链接。

### `GET /imagine`（或 `/imagine.html`）

把文字生图页面发给浏览器。

### `POST /api/generate-image`

文字生图主接口，`application/json`。

请求：

```json
{ "prompt": "一只戴着宇航头盔的橘猫，漂浮在星云里，电影感光线", "aspect_ratio": "16:9" }
```

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `prompt` | 是 | 画面描述，最多 2000 字，空字符串会被拒绝 |
| `aspect_ratio` | 否 | 画面比例，默认 `1:1`。只接受白名单里的值：`1:1` `3:2` `2:3` `4:3` `3:4` `16:9` `9:16` `4:5` `5:4` `21:9`；传了别的会被当成 `1:1` |

成功：

```json
{
  "ok": true,
  "image": "data:image/png;base64,iVBORw0KGgo...",
  "model": "openai/gpt-5.4-image-2",
  "aspectRatio": "16:9",
  "seconds": 18.4,
  "cost": 0.003896
}
```

`cost` 是这次调用的真实花费（美元，取自 OpenRouter 返回的 `usage.cost`），页面会把它显示在结果卡片上。

失败（HTTP 状态码 + 中文原因）：

```json
{ "ok": false, "error": "请先写一段描述，再点「生成图片」" }
```

| 状态码 | 含义 |
| --- | --- |
| 400 | 没写描述、描述超过 2000 字，或 OpenRouter 认为参数不合法 |
| 401 | OpenRouter 拒绝了请求：Key 无效 / 已过期 |
| 402 | OpenRouter 账户额度不足 |
| 429 | 请求太频繁 |
| 500 | 服务器没配置 `OPENROUTER_API_KEY` |
| 502 | 连不上 OpenRouter（网络问题），或模型这次没返回图片 |
| 504 | 等超过 240 秒模型还没出图 |

> 关于实现：后端会把请求转发到 `POST https://openrouter.ai/api/v1/images`（OpenRouter 的图像生成接口），带上 `model` / `prompt` / `aspect_ratio` / `output_format: "png"`，然后把返回的 `data[0].b64_json` 拼成 data URL 交给网页。OpenRouter 也支持用 `/api/v1/chat/completions` + `modalities: ["image","text"]` 出图，本项目用的是前者（更直接，返回结构更简单）。

---

## 可调参数（都在 `server/.env` 里）

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `REPLICATE_API_TOKEN` | 无（必填） | Replicate 的 API Token |
| `OPENROUTER_API_KEY` | 无（必填） | OpenRouter 的 API Key |
| `REPLICATE_MODEL` | `lucataco/remove-bg` | 换模型用。可以只写模型名（`owner/name`），服务会在**首次调用时自动查出它的最新版本号**并缓存；也可以直接写死成 `owner/name:版本号` 来锁定版本。之所以内部一定要带上版本号，见下面常见问题里那条 404 |
| `OPENROUTER_IMAGE_MODEL` | `openai/gpt-5.4-image-2` | 换生图模型用，填 OpenRouter 上的模型 id 即可 |
| `OPENROUTER_IMAGE_URL` | `https://openrouter.ai/api/v1/images` | 生图接口地址，一般不用改 |
| `OPENROUTER_TIMEOUT_SEC` | `240` | 等图的最长秒数，超时会返回 504 |
| `PORT` | `3000` | 服务端口，改了之后网页也要换成对应端口打开 |
| `MAX_UPLOAD_MB` | `10` | 上传体积上限。同时记得把 `index.html` 里第三屏脚本的 `MAX_MB` 改成一样的值 |

> 改了 `.env` 之后要**重启后端**才生效。

---

## 想改样式 / 改内容

- **颜色**：`index.html` 顶部的 `:root { ... }` 里改 CSS 变量即可，全站跟着变。第三屏用的是同一套变量（`--accent`、`--rule`、`--surface`、`--radius` 等），所以风格和第一、二屏一致。
- **文案**：第三屏在 `index.html` 里搜 `id="cutout"` 就能找到整段结构。
- **交互逻辑**：文件末尾第三段 `<script>`（搜「一键去除图片背景」）就是它的脚本，没用到任何第三方库。
- **新增学习记录**：在第二屏的时间线里按现有节点复制一段 `<li>` 即可。
- **文字生图页**：`imagine.html` 是独立一页，同样是零依赖。想换风格就改它顶部的 `:root { ... }`（现在是一套 Google 风格的令牌：`--blue #1a73e8`、`--text #202124`、`--line #dadce0`、胶囊圆角 `--radius: 28px` 等）；想改灵感标签、比例选项，改脚本开头的 `IDEAS` 和 `RATIOS` 两个数组即可；字数上限 `MAX_PROMPT` 要和 `server/server.js` 里的一致。

---

## 常见问题

**Q：点「去除背景」提示「连不上后端」？**
说明这个页面不是从后端打开的。请确认后端已启动，并且地址栏是 `http://localhost:3000`，而不是 `file:///.../index.html`。

**Q：提示「服务器没有配置 REPLICATE_API_TOKEN」？**
`server/.env` 还没建好或没填。把 `.env.example` 复制成 `.env`，填上 Token，然后**重启后端**（`Ctrl+C` 停掉，再 `npm start`）。

**Q：提示「Replicate 拒绝了这次请求」？**
Token 不对、被删除或复制时多了空格。去 <https://replicate.com/account/api-tokens> 重新生成一个。

**Q：提示「额度不足或未绑定支付方式」？**
Replicate 是按用量计费的，账户需要有效的支付方式 / 可用额度。去 <https://replicate.com/account/billing> 看一下。

**Q：报 `failed with status 404 Not Found`？**
这是 Replicate 接口的一个坑，跟 Token 无关。调社区模型时，如果只给模型名（`owner/name`），SDK 会去请求 `POST /v1/models/{owner}/{name}/predictions`，而这个接口对社区模型会返回 404；只有带上版本号（`owner/name:版本号`）时，SDK 才走通用的 `POST /v1/predictions`，那条才是可用的。本项目的后端已经自动处理了这件事：它会在**首次调用时**替你查出模型的最新版本号并缓存（启动日志里会提示「首次调用时自动解析到最新版本」）。如果你想手动锁定版本，把 `server/.env` 里的 `REPLICATE_MODEL` 写成 `lucataco/remove-bg:95fcc2a26d3899cd6c2691c900465aaeff466285a65c14638cc5f36f34befaf1` 这样的完整形式即可。

**Q：提示图片太大？**
压到 10MB 以内，或者同时调大 `server/.env` 里的 `MAX_UPLOAD_MB` 和 `index.html` 里的 `MAX_MB`。

**Q：报 `listen EADDRINUSE: address already in use ::3000`？**
3000 端口被别的程序占了。要么关掉那个程序，要么在 `server/.env` 里改 `PORT`，然后用新端口打开网页。

**Q：抠图结果边缘不够干净？**
`lucataco/remove-bg` 是通用抠图模型，对人和常见物体效果不错，但对**毛发、半透明物体、背景和主体颜色接近**的图片可能不完美。可以换成 Replicate 上别的抠图/分割模型（改 `REPLICATE_MODEL` 即可）。

**Q：第一次调用特别慢？**
Replicate 上冷启动（要拉镜像、装环境）会慢一些，之后就快了。

**Q：`/imagine` 页面提示「还没配置 OPENROUTER_API_KEY」？**
`server/.env` 里的 OpenRouter Key 是空的。去 <https://openrouter.ai/keys> 建一个填进去，然后重启后端。

**Q：提示「OpenRouter 账户额度不足」？**
文字生图是**按用量计费**的（`openai/gpt-5.4-image-2` 目前约 $8/百万输入 token、$15/百万输出 token；实测出图一次约 **$0.004**）。去 <https://openrouter.ai/credits> 充一点额度即可。

**Q：提示「连不上 OpenRouter」？**
先看后端终端里打印的那行 `[生图] 请求 OpenRouter 失败：…`，它会带上原始错误信息：
- `getaddrinfo ENOTFOUND` / `fetch failed` → 电脑网络不通，或走了代理但 Node 没读到代理设置。
- `Cannot convert argument to a ByteString…` → 请求头里混进了中文等非 latin-1 字符（HTTP 头只能放英文/数字）。本项目已经修好了，如果你自己加了头部标识，注意这条。

**Q：出图很慢 / 提示「等太久了」？**
一张图通常要 **15～25 秒**，高峰期会更久。默认最多等 240 秒，不够就在 `server/.env` 里把 `OPENROUTER_TIMEOUT_SEC` 调大，然后重启后端。

**Q：生成失败但显示「已中止」？**
那是你自己点了「中止」（或刷新了页面），属于主动取消，不会生成新费用。

**Q：生成结果里出现奇怪的水印 / 乱码字？**
`gpt-5.4-image-2` 会在图里渲染文字，但中文字形偶有崩坏。想避免就少在描述里要求具体文字，或者改用「不要出现文字」这类否定描述。

---

## 安全提醒

- **两个 Key** 都只放在 `server/.env` 里，代码和网页里都没有它们；`.env` 已在 `.gitignore` 中。
- 图片全程在内存里处理，不落盘、不保存，请求结束就没了；你输入的描述也只在内存中转一手，不写日志（终端只记耗时和花费）。
- 这个后端默认只监听本机（`localhost`），适合自己用；**不要**直接部署到公网，否则任何人都能刷你的 Replicate / OpenRouter 额度。真要部署，请自行加上访问控制（登录、限流、验证码等）。
- 曾在聊天 / 截图 / 提交记录里暴露过的 Key，建议去对应控制台**重新生成一个**并替换掉旧的。

---

## 技术栈

| 层 | 用了什么 |
| --- | --- |
| 前端 | 原生 HTML / CSS / JavaScript（自包含、零依赖、图标是内联 SVG） |
| 后端 | Node.js（≥18.17）、Express 4、multer 2（内存存储）、dotenv、内置 `fetch` + `AbortController` |
| AI（抠图） | Replicate 官方 SDK，模型 `lucataco/remove-bg` |
| AI（文字生图） | OpenRouter HTTP 接口 `POST /api/v1/images`，模型 `openai/gpt-5.4-image-2` |
