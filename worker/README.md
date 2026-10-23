# dm-sync Worker

为静态站点提供高亮笔记同步。服务端只保存 AES-GCM 密文，不保存明文，也不接触同步密钥。

## 部署

### 方式 A：Cloudflare 控制台

1. 登录 <https://dash.cloudflare.com>
2. **Workers & Pages → Create → Worker**，名称填 `dm-sync`，Deploy
3. **Storage & Databases → KV → Create namespace**，名称填 `dm-sync-vaults`
4. 回到 Worker → **Settings → Bindings**：
   - 添加 **KV Namespace**
   - Variable name：`VAULTS`
   - 选择刚创建的 namespace
5. **Settings → Variables** 添加：
   - `ALLOWED_ORIGIN = https://dengyifan.github.io`
6. **Edit code**，把 `worker.js` 全量粘贴进去，Deploy
7. 记下地址：`https://dm-sync.<你的子域>.workers.dev`

### 方式 B：Wrangler CLI

```bash
npm i -D wrangler
npx wrangler login
npx wrangler kv namespace create VAULTS
# 把输出里的 id 填进 wrangler.toml
npx wrangler deploy
```

## 接口

```text
GET  /v1/vault/:id
PUT  /v1/vault/:id
```

`id` 为 16–64 位 `[A-Za-z0-9_-]`，客户端用 128 位随机值（base64url）。

### GET

```bash
curl -i https://dm-sync.example.workers.dev/v1/vault/testvault1234567890 \
  -H 'Origin: https://dengyifan.github.io'
```

首次返回：

```json
{ "rev": 0, "ciphertext": null, "updatedAt": 0 }
```

已有数据返回：

```json
{ "rev": 3, "ciphertext": "base64...", "updatedAt": 1760000000000 }
```

### PUT

```bash
curl -i -X PUT https://dm-sync.example.workers.dev/v1/vault/testvault1234567890 \
  -H 'Origin: https://dengyifan.github.io' \
  -H 'Content-Type: application/json' \
  -H 'If-Match: "0"' \
  -H 'X-Vault-Token: test-token-hash' \
  --data '{"ciphertext":"hello"}'
```

成功：

```json
{ "rev": 1, "updatedAt": 1760000000000 }
```

版本不一致：

```json
{ "error": "conflict", "rev": 1 }
```

客户端应重新 GET、合并、再 PUT。

## 约定

- `ciphertext` 是客户端加密后的字符串，Worker 不解析。
- 新建时必须带 `If-Match: "0"`；更新时带当前 `rev`。
- `X-Vault-Token` 可选；首次 PUT 带了就会锁定，之后 GET/PUT 必须一致。
  建议客户端传 `SHA-256(secret)` 的十六进制，Worker 只做相等比较。
- `ALLOWED_ORIGIN` 支持逗号分隔和 `http://localhost:*` 端口通配。
- KV 是最终一致的；并发写入概率极低，客户端靠 `rev` 冲突重试兜底。
- 删除数据：控制台 KV 里删除 `vault:<id>`，或删除整个 namespace；删除前先导出备份。

## 页面端接入

站点所有页面已经引入：

```html
<script src="style/highlight.js"></script>
<script src="style/sync.js"></script>
```

打开右下角 🖍 面板 → **同步**：

1. 点 **生成同步码**，得到 `<vaultId>.<secret>` 和配对链接。
2. 在另一台设备打开配对链接，自动写入同步配置并拉取数据。
3. 之后每次高亮/备注变更会延迟约 1.2 秒推送；页面重新获得焦点、恢复可见或网络恢复时会拉取。
4. **复制链接** 可再次拿到配对链接；**关闭** 只删除本机配置，本地高亮和云端密文都保留。

同步码就是密钥，不要发到公开渠道。链接中的 `#dm-sync=...` 在页面加载后会被 `history.replaceState` 移除，但浏览器历史/聊天记录里仍可能留痕。

### 本地测试

`style/sync.js` 默认请求 `https://dm-sync.waynesilver.workers.dev`。本地联调可以在加载脚本前覆盖：

```html
<script>
  window.DM_SYNC_ENDPOINT = 'http://localhost:8787';
</script>
```

同时把 Worker 的 `ALLOWED_ORIGIN` 加上测试来源，例如：

```toml
[vars]
ALLOWED_ORIGIN = "https://dengyifan.github.io,http://localhost:*"
```

或本地用 `wrangler dev` 起一个同源/已放行的 Worker。

### 数据与合并

- 客户端把所有页面聚合成 `{ v: 1, pages: { "/path": [highlight...] } }`，用 AES-GCM 加密后上传。
- 每条高亮带 `id`、`updatedAt`、`deleted`、`deletedAt`；删除不直接移除数组，而是写墓碑。
- 两端口碑/编辑按 `updatedAt` 做 LWW 合并；删除优先于同时间戳的未删除记录。
- `style/highlight.js` 的“导出全部/导入”仍是本地备份通道，导入同样按 `updatedAt` 合并。

### 注意

- `workers.dev` 在部分网络环境可能不可达；如果长期使用，建议给 Worker 绑定自定义域名，并同步修改 `style/sync.js` 的 `ENDPOINT`（或页面里的 `window.DM_SYNC_ENDPOINT`）。
- Cloudflare KV 有最终一致性；刚推送后另一台设备立刻拉取，可能短暂看到旧版本，稍后重试即可。
- 密钥只存在浏览器 `localStorage`；清理站点数据会丢失本机同步配置，需要重新配对。
