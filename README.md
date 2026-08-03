# 德州扑克手牌复盘器

这个版本已经从纯静态网页改为“前端 + 后端”：

- 前端负责牌桌交互、手牌记录、收藏和玩家信息。
- 后端负责登录、会员校验，以及调用 DeepSeek。
- DeepSeek API Key 只放在后端环境变量里，不会出现在用户浏览器里。

## 本地启动

1. 复制 `.env.example` 为 `.env`。
2. 在 `.env` 里填写：
   - `DEEPSEEK_API_KEY`
   - `ADMIN_LOGIN_CODE`
   - `SESSION_SECRET`
3. 启动：

```bash
npm start
```

默认地址是：

```text
http://localhost:4177
```

## 公网部署

部署到公网请看 [DEPLOY.md](./DEPLOY.md)。当前项目需要 Node 后端，不能再用纯静态托管。

## 管理员登录

打开网页后，使用 `.env` 里的 `ADMIN_LOGIN_CODE` 登录管理员账号。

管理员账号默认拥有会员权限，可以直接进行牌谱分析。

管理员登录后可以在页面里的“后台管理”中：

- 配置或更新 DeepSeek API Key 和模型名。
- 查看注册用户和会员状态。
- 编辑用户会员有效期。
- 删除已注册用户。

后台配置会保存在本机 `data/settings.json`，用户数据会保存在 `data/users.json`。这两个文件已被 `.gitignore` 忽略，不应上传到公开代码仓库。

## 账号密码登录

当前内测版本使用账号密码登录。测试账号保存在 `data/users.json`，密码只保存哈希。

本地已生成 5 个测试账号，默认开通 30 天会员：

```text
poker01 / R8mK2vQ9
poker02 / T6pN4xL7
poker03 / W3cJ9sD5
poker04 / H7qB2mZ8
poker05 / Y5nF8rP3
```

## 微信登录

如果要启用微信登录，需要在 `.env` 里配置：

```text
PUBLIC_BASE_URL=https://你的正式域名
WECHAT_APP_ID=你的微信应用AppID
WECHAT_APP_SECRET=你的微信应用Secret
WECHAT_OAUTH_MODE=web
```

如果是在微信公众号内打开网页，可以把 `WECHAT_OAUTH_MODE` 改为：

```text
WECHAT_OAUTH_MODE=mp
```

微信登录成功后，新用户默认不是会员，需要管理员开通。
