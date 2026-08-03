# 公网部署

当前项目已经是 Node 后端服务，不能用纯静态托管。推荐先用 Render 部署，步骤最少。

## 部署到 Render

1. 把整个项目上传到 GitHub。
2. 打开 Render，新建 `Blueprint` 或 `Web Service`。
3. 选择这个 GitHub 仓库。
4. 如果使用 Blueprint，Render 会读取 `render.yaml`。
5. 配置这些环境变量：

```text
PUBLIC_BASE_URL=https://你的Render域名
SESSION_SECRET=一串很长的随机字符
ADMIN_LOGIN_CODE=你的管理员登录码
DEEPSEEK_API_KEY=你的DeepSeek Key
DEEPSEEK_MODEL=deepseek-v4-pro
SEED_TEST_ACCOUNTS=true
```

6. 部署完成后，Render 会给你一个公网链接。

## 登录方式

管理员：

```text
使用 ADMIN_LOGIN_CODE 登录
```

测试账号：

```text
poker01 / R8mK2vQ9
poker02 / T6pN4xL7
poker03 / W3cJ9sD5
poker04 / H7qB2mZ8
poker05 / Y5nF8rP3
```

服务器第一次启动时会自动创建这 5 个账号，并默认开通 30 天会员。

## 数据保存

后台配置和用户数据保存在服务端 `data/` 目录。`render.yaml` 已配置持久化磁盘，避免重启后丢失：

```text
/opt/render/project/src/data
```

如果换其他平台部署，需要确认它支持持久化文件目录，或者后续改成数据库。
