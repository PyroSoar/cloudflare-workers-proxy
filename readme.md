# Cloudflare Workers 部署指南

本项目展示了如何在 **Cloudflare Workers** 中添加代理代码，并扩展功能（如 `/api/` 与 `/fetch/` 路径的区分、大小限制、首页展示等）。

---

## 🚀 部署步骤

### 1. 创建 Worker
1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 在左侧菜单选择 **Workers & Pages**。
3. 点击 **Create Worker**。
4. 输入 Worker 名称，点击 **Deploy**。

---

### 2. 编辑 Worker 代码
1. 在 Worker 编辑器中，删除默认的 `index.js` 内容。
2. 将本仓库中的完整代码（`worker.js`）复制粘贴到编辑器中。
3. 点击 **Save and Deploy**。

---

### 3. 功能说明
- **首页 (`/` 或 `/index.html`)**  
  - 可以返回内置的 HTML 内容，或通过 `fetch` 从 GitHub 仓库拉取 `index.html`。
- **API 模式 (`/api/`)**  
  - 只允许返回文本、JSON、XML、表单、流式数据等白名单类型。
  - 保留原始 HTTP 请求方法，并转发 `POST`、`PUT`、`PATCH`、`QUERY` 请求体。
  - `/api/` 与 `/fetch/` 都会保留客户端的端到端请求头；`Host`、`Connection`、`Content-Length` 等逐跳或运行时管理的请求头除外。
  - 将 `Referer` 伪造为目标站点根地址，并将 `Origin` 伪造为目标站点源。
  - `DELETE` 请求体没有通用的 HTTP 语义；仅应在目标 API 明确支持时使用，此时代理会原样转发。
  - `GET`、`HEAD` 和 `TRACE` 不转发请求体。
  - `OPTIONS` 由 Worker 用于 CORS 预检，不会代理到目标服务器。
  - CORS 预检响应的允许方法列表包含 `QUERY`。
  - 请求前会先发起 `HEAD` 检查，超过 1MB 返回 `413 Payload Too Large`。
  - 响应头中会增加：
    - `X-Proxy-Method`: 请求方法（GET/POST/QUERY 等）
    - `X-Proxy-Target`: 目标地址
- **Fetch 模式 (`/fetch/`)**  
  - 用于资源直链（图片、音频等二进制）。
  - 保留端到端请求头，并伪造目标站点的 `Referer` 和 `Origin`。
  - 同样有 1MB 限制。
  - 响应头中也会增加 `X-Proxy-Method` 和 `X-Proxy-Target`。

---

### 4. 示例请求
```bash
# 访问首页
curl https://<your-worker>.workers.dev/

# API 模式请求 JSON
curl https://<your-worker>.workers.dev/api/https://httpbin.org/json

# 使用 HTTP QUERY 方法（请求体会转发至目标服务器）
curl -X QUERY https://<your-worker>.workers.dev/api/https://api.example.com/search \
  -H "Content-Type: application/json" \
  -d '{"query":"cloudflare workers"}'

# PUT/PATCH/DELETE 请求体也会在适用时转发
curl -X PUT https://<your-worker>.workers.dev/api/https://api.example.com/items/1 \
  -H "Content-Type: application/json" \
  -d '{"name":"updated item"}'

# Fetch 模式请求图片
curl https://<your-worker>.workers.dev/fetch/https://httpbin.org/image/png
```
