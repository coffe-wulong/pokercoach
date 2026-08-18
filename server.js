import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));
const envFile = join(rootDir, ".env");
const publicDir = join(rootDir, "outputs", "poker-reviewer");
const dataDir = join(rootDir, "data");
const usersFile = join(dataDir, "users.json");
const settingsFile = join(dataDir, "settings.json");

function loadEnvFile() {
  if (!existsSync(envFile)) return;
  const lines = readFileSync(envFile, "utf8").split(/\r?\n/);
  lines.forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index <= 0) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) process.env[key] = value;
  });
}

loadEnvFile();

const port = Number(process.env.PORT || 4177);
const baseUrl = process.env.PUBLIC_BASE_URL || `http://localhost:${port}`;
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-change-me";
const deepSeekModel = process.env.DEEPSEEK_MODEL || "deepseek-v4-pro";
const adminOpenid = process.env.ADMIN_OPENID || "admin-local";

const sessions = new Map();
const pendingWechatStates = new Set();

function ensureDataStore() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(usersFile)) writeFileSync(usersFile, "{}");
  if (!existsSync(settingsFile)) writeFileSync(settingsFile, "{}");
}

function readUsers() {
  ensureDataStore();
  try {
    return JSON.parse(readFileSync(usersFile, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeUsers(users) {
  ensureDataStore();
  writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

function createPasswordHash(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 32).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored = "") {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function readSettings() {
  ensureDataStore();
  try {
    return JSON.parse(readFileSync(settingsFile, "utf8")) || {};
  } catch {
    return {};
  }
}

function writeSettings(settings) {
  ensureDataStore();
  writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
}

function deepSeekConfig() {
  const settings = readSettings();
  return {
    apiKey: settings.deepSeekApiKey || process.env.DEEPSEEK_API_KEY || "",
    model: settings.deepSeekModel || process.env.DEEPSEEK_MODEL || deepSeekModel
  };
}

function maskedSecret(value = "") {
  if (!value) return "";
  return value.length <= 8 ? "已配置" : `${value.slice(0, 3)}****${value.slice(-4)}`;
}

function publicSettings() {
  const config = deepSeekConfig();
  return {
    deepSeekConfigured: Boolean(config.apiKey),
    deepSeekApiKeyMasked: maskedSecret(config.apiKey),
    deepSeekModel: config.model
  };
}

function upsertUser(profile) {
  const users = readUsers();
  const previous = users[profile.openid] || {};
  const now = new Date().toISOString();
  const user = {
    openid: profile.openid,
    unionid: profile.unionid || previous.unionid || "",
    nickname: profile.nickname || previous.nickname || "微信用户",
    avatar: profile.avatar || previous.avatar || "",
    role: profile.openid === adminOpenid ? "admin" : previous.role || "user",
    memberUntil: previous.memberUntil || "",
    createdAt: previous.createdAt || now,
    lastLoginAt: now
  };
  if (user.role === "admin") user.memberUntil = "2099-12-31T23:59:59.000Z";
  users[user.openid] = user;
  writeUsers(users);
  return user;
}

function seedInitialAccounts() {
  if (process.env.SEED_TEST_ACCOUNTS === "false") return;
  const users = readUsers();
  const accounts = [
    ["poker01", "R8mK2vQ9"],
    ["poker02", "T6pN4xL7"],
    ["poker03", "W3cJ9sD5"],
    ["poker04", "H7qB2mZ8"],
    ["poker05", "Y5nF8rP3"]
  ];
  const now = new Date().toISOString();
  const memberUntil = new Date(Date.now() + 30 * 86400000).toISOString();
  let changed = false;
  accounts.forEach(([username, password], index) => {
    const openid = `account:${username}`;
    if (users[openid]) return;
    users[openid] = {
      openid,
      username,
      passwordHash: createPasswordHash(password),
      nickname: `测试账号 ${index + 1}`,
      avatar: "",
      role: "user",
      memberUntil,
      createdAt: now,
      lastLoginAt: "",
      authType: "password"
    };
    changed = true;
  });
  if (changed) writeUsers(users);
}

function isMember(user) {
  return user?.role === "admin" || (user?.memberUntil && new Date(user.memberUntil).getTime() > Date.now());
}

function publicUser(user) {
  if (!user) return null;
  return {
    openid: user.openid,
    username: user.username || "",
    nickname: user.nickname,
    avatar: user.avatar,
    role: user.role,
    memberUntil: user.memberUntil,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt,
    isMember: isMember(user),
    isAdmin: user.role === "admin"
  };
}

function sign(value) {
  return createHmac("sha256", sessionSecret).update(value).digest("hex");
}

function createSession(user) {
  const id = randomBytes(24).toString("hex");
  sessions.set(id, { openid: user.openid, createdAt: Date.now() });
  return `${id}.${sign(id)}`;
}

function parseCookies(req) {
  return Object.fromEntries(String(req.headers.cookie || "")
    .split(";")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const index = item.indexOf("=");
      return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
    }));
}

function currentUser(req) {
  const token = parseCookies(req).session || "";
  const [id, signature] = token.split(".");
  if (!id || signature !== sign(id)) return null;
  const session = sessions.get(id);
  if (!session) return null;
  return readUsers()[session.openid] || null;
}

function setSessionCookie(res, user) {
  const secure = baseUrl.startsWith("https://") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `session=${encodeURIComponent(createSession(user))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", "session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function mimeType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon"
  }[extname(path)] || "application/octet-stream";
}

function serveStatic(req, res) {
  const url = new URL(req.url, baseUrl);
  const requested = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const fullPath = normalize(join(publicDir, requested));
  if (!fullPath.startsWith(publicDir) || !existsSync(fullPath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": mimeType(fullPath) });
  createReadStream(fullPath).pipe(res);
}

function requireAuth(req, res) {
  const user = currentUser(req);
  if (!user) {
    sendJson(res, 401, { error: "请先登录。" });
    return null;
  }
  return user;
}

function requireMember(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (!isMember(user)) {
    sendJson(res, 403, { error: "当前账号还不是会员，请联系管理员开通。" });
    return null;
  }
  return user;
}

function requireAdmin(req, res) {
  const user = requireAuth(req, res);
  if (!user) return null;
  if (user.role !== "admin") {
    sendJson(res, 403, { error: "只有管理员可以执行这个操作。" });
    return null;
  }
  return user;
}

async function callDeepSeek(messages) {
  const { apiKey, model } = deepSeekConfig();
  if (!apiKey) throw new Error("服务端还没有配置 DeepSeek API Key。");
  const startedAt = Date.now();
  const requestId = randomBytes(4).toString("hex");
  console.log(`[DeepSeek ${requestId}] start model=${model} messages=${Array.isArray(messages) ? messages.length : 0}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 180000);
  let response;
  try {
    response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages,
        thinking: { type: "disabled" },
        max_tokens: 6000,
        stream: false
      })
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      console.error(`[DeepSeek ${requestId}] timeout after ${Date.now() - startedAt}ms`);
      throw new Error("DeepSeek 请求超时，请稍后重试。");
    }
    console.error(`[DeepSeek ${requestId}] network error: ${error.message || error}`);
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `DeepSeek 请求失败，HTTP ${response.status}`;
    console.error(`[DeepSeek ${requestId}] api error ${response.status}: ${message}`);
    throw new Error(message);
  }
  const choice = data.choices?.[0];
  const text = choice?.message?.content || data.output_text || "";
  console.log(`[DeepSeek ${requestId}] done ${Date.now() - startedAt}ms finish=${choice?.finish_reason || "unknown"} chars=${text.length}`);
  return text;
}

function wechatAuthorizeUrl() {
  const appid = process.env.WECHAT_APP_ID;
  if (!appid) return null;
  const state = randomBytes(16).toString("hex");
  pendingWechatStates.add(state);
  const redirect = encodeURIComponent(`${baseUrl}/auth/wechat/callback`);
  if ((process.env.WECHAT_OAUTH_MODE || "web") === "mp") {
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${appid}&redirect_uri=${redirect}&response_type=code&scope=snsapi_userinfo&state=${state}#wechat_redirect`;
  }
  return `https://open.weixin.qq.com/connect/qrconnect?appid=${appid}&redirect_uri=${redirect}&response_type=code&scope=snsapi_login&state=${state}#wechat_redirect`;
}

async function exchangeWechatCode(code) {
  const appid = process.env.WECHAT_APP_ID;
  const secret = process.env.WECHAT_APP_SECRET;
  if (!appid || !secret) throw new Error("微信登录还没有配置 AppID 和 AppSecret。");
  const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${appid}&secret=${secret}&code=${code}&grant_type=authorization_code`;
  const token = await fetch(tokenUrl).then(res => res.json());
  if (token.errcode) throw new Error(token.errmsg || "微信授权失败。");
  const infoUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${token.access_token}&openid=${token.openid}&lang=zh_CN`;
  const info = await fetch(infoUrl).then(res => res.json());
  if (info.errcode) throw new Error(info.errmsg || "获取微信用户信息失败。");
  return upsertUser({
    openid: info.openid,
    unionid: info.unionid,
    nickname: info.nickname,
    avatar: info.headimgurl
  });
}

async function handleApi(req, res) {
  const url = new URL(req.url, baseUrl);
  if (req.method === "GET" && url.pathname === "/api/session") {
    sendJson(res, 200, {
      user: publicUser(currentUser(req)),
      wechatEnabled: false,
      passwordLoginEnabled: true,
      adminLoginEnabled: Boolean(process.env.ADMIN_LOGIN_CODE)
    });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/login") {
    const body = await readJson(req).catch(() => ({}));
    const username = String(body.username || "").trim();
    const password = String(body.password || "");
    const users = readUsers();
    const user = Object.values(users).find(item => item.username === username);
    if (!user || !verifyPassword(password, user.passwordHash)) {
      sendJson(res, 403, { error: "账号或密码不正确。" });
      return;
    }
    user.lastLoginAt = new Date().toISOString();
    users[user.openid] = user;
    writeUsers(users);
    setSessionCookie(res, user);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/dev-login") {
    const body = await readJson(req).catch(() => ({}));
    if (!process.env.ADMIN_LOGIN_CODE || body.code !== process.env.ADMIN_LOGIN_CODE) {
      sendJson(res, 403, { error: "管理员登录码不正确，或服务端没有配置 ADMIN_LOGIN_CODE。" });
      return;
    }
    const user = upsertUser({ openid: adminOpenid, nickname: "管理员" });
    setSessionCookie(res, user);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/logout") {
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/review") {
    requireMember(req, res);
    if (res.writableEnded) return;
    const body = await readJson(req);
    const text = await callDeepSeek(body.messages || []);
    sendJson(res, 200, { text });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/player-analysis") {
    requireMember(req, res);
    if (res.writableEnded) return;
    const body = await readJson(req);
    const text = await callDeepSeek(body.messages || []);
    sendJson(res, 200, { text });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/users") {
    const user = requireAdmin(req, res);
    if (!user || res.writableEnded) return;
    sendJson(res, 200, { users: Object.values(readUsers()).map(publicUser) });
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/admin/settings") {
    const user = requireAdmin(req, res);
    if (!user || res.writableEnded) return;
    sendJson(res, 200, { settings: publicSettings() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/settings") {
    const user = requireAdmin(req, res);
    if (!user || res.writableEnded) return;
    const body = await readJson(req);
    const settings = readSettings();
    if (typeof body.deepSeekApiKey === "string" && body.deepSeekApiKey.trim()) {
      settings.deepSeekApiKey = body.deepSeekApiKey.trim();
    }
    if (typeof body.deepSeekModel === "string" && body.deepSeekModel.trim()) {
      settings.deepSeekModel = body.deepSeekModel.trim();
    }
    writeSettings(settings);
    sendJson(res, 200, { settings: publicSettings() });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/grant-member") {
    const user = requireAdmin(req, res);
    if (!user || res.writableEnded) return;
    const body = await readJson(req);
    const users = readUsers();
    if (!users[body.openid]) {
      sendJson(res, 404, { error: "没有找到这个用户。" });
      return;
    }
    const days = Math.max(1, Number(body.days || 30));
    users[body.openid].memberUntil = new Date(Date.now() + days * 86400000).toISOString();
    writeUsers(users);
    sendJson(res, 200, { user: publicUser(users[body.openid]) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/update-member") {
    const user = requireAdmin(req, res);
    if (!user || res.writableEnded) return;
    const body = await readJson(req);
    const users = readUsers();
    if (!users[body.openid]) {
      sendJson(res, 404, { error: "没有找到这个用户。" });
      return;
    }
    if (users[body.openid].role === "admin") {
      sendJson(res, 403, { error: "不能修改管理员的会员有效期。" });
      return;
    }
    users[body.openid].memberUntil = body.memberUntil ? new Date(body.memberUntil).toISOString() : "";
    writeUsers(users);
    sendJson(res, 200, { user: publicUser(users[body.openid]) });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/admin/delete-user") {
    const user = requireAdmin(req, res);
    if (!user || res.writableEnded) return;
    const body = await readJson(req);
    const users = readUsers();
    if (!users[body.openid]) {
      sendJson(res, 404, { error: "没有找到这个用户。" });
      return;
    }
    if (users[body.openid].role === "admin") {
      sendJson(res, 403, { error: "不能删除管理员账号。" });
      return;
    }
    delete users[body.openid];
    writeUsers(users);
    sendJson(res, 200, { ok: true });
    return;
  }
  sendJson(res, 404, { error: "接口不存在。" });
}

async function handleWechat(req, res) {
  const url = new URL(req.url, baseUrl);
  if (url.pathname === "/auth/wechat/start") {
    const target = wechatAuthorizeUrl();
    if (!target) {
      res.writeHead(302, { Location: "/?login=wechat-unconfigured" });
      res.end();
      return;
    }
    res.writeHead(302, { Location: target });
    res.end();
    return;
  }
  if (url.pathname === "/auth/wechat/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state || !pendingWechatStates.has(state)) {
      res.writeHead(302, { Location: "/?login=wechat-failed" });
      res.end();
      return;
    }
    pendingWechatStates.delete(state);
    try {
      const user = await exchangeWechatCode(code);
      setSessionCookie(res, user);
      res.writeHead(302, { Location: "/" });
      res.end();
    } catch (error) {
      res.writeHead(302, { Location: `/?login=${encodeURIComponent(error.message)}` });
      res.end();
    }
  }
}

seedInitialAccounts();

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, baseUrl);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    if (url.pathname.startsWith("/auth/wechat/")) {
      await handleWechat(req, res);
      return;
    }
    serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务端错误。" });
  }
}).listen(port, "0.0.0.0", () => {
  console.log(`Poker reviewer running at ${baseUrl}`);
});
