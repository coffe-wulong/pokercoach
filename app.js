const styles = ["普通", "松凶", "紧凶", "紧弱", "松弱"];
const streets = ["Preflop", "Flop", "Turn", "River"];
const ranks = ["A", "K", "Q", "J", "T", "9", "8", "7", "6", "5", "4", "3", "2"];
const suits = [
  { code: "s", label: "♠", name: "黑桃" },
  { code: "h", label: "♥", name: "红桃" },
  { code: "d", label: "♦", name: "方片" },
  { code: "c", label: "♣", name: "梅花" }
];
const storageKeys = {
  favorites: "pokerReviewerFavorites",
  players: "pokerReviewerPlayers"
};
const minPlayerAnalysisHands = 3;
const playerBaselineRecentHands = 3;
const positionsByPlayers = {
  2: ["BTN/SB", "BB"],
  3: ["BTN", "SB", "BB"],
  4: ["BTN", "SB", "BB", "UTG"],
  5: ["BTN", "SB", "BB", "UTG", "CO"],
  6: ["BTN", "SB", "BB", "UTG", "HJ", "CO"],
  7: ["BTN", "SB", "BB", "UTG", "MP", "HJ", "CO"],
  8: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "HJ", "CO"],
  9: ["BTN", "SB", "BB", "UTG", "UTG+1", "MP", "LJ", "HJ", "CO"]
};
const seatPositions = [
  [50, 17], [68, 20], [81, 34], [81, 66], [68, 80],
  [50, 83], [32, 80], [19, 66], [19, 34]
];
const compactSeatPositions = [
  [50, 10], [76, 18], [88, 38], [88, 62], [76, 82],
  [50, 90], [24, 82], [12, 62], [12, 38]
];
const seatLayoutsByPlayers = {
  2: [0, 5],
  3: [0, 3, 6],
  4: [0, 2, 5, 7],
  5: [0, 2, 4, 6, 8],
  6: [0, 1, 3, 5, 6, 8],
  7: [0, 1, 2, 4, 5, 7, 8],
  8: [0, 1, 2, 3, 5, 6, 7, 8],
  9: [0, 1, 2, 3, 4, 5, 6, 7, 8]
};

function createPlayer(playerNumber, seatIndex) {
  return {
    id: `P${playerNumber}`,
    stack: defaultPlayerStack(),
    style: "普通",
    hero: playerNumber === 1,
    dealer: playerNumber === 1,
    folded: false,
    seatIndex
  };
}

function buildSeats(playerCount = 9) {
  const seats = Array.from({ length: 9 }, () => null);
  const layout = seatLayoutsByPlayers[playerCount] || seatLayoutsByPlayers[9];
  layout.forEach((seatIndex, index) => {
    seats[seatIndex] = createPlayer(index + 1, seatIndex);
  });
  return seats;
}

function defaultStackForBlinds(blindsText = "1/2") {
  const values = String(blindsText).split(/[\\s/]+/).map(value => Number(value)).filter(Number.isFinite);
  const smallBlind = values[0] || 1;
  const bigBlind = values[1] || values[0] || 2;
  const bbCount = smallBlind === 1 && bigBlind === 2 ? 200 : 100;
  return bigBlind * bbCount;
}

function defaultPlayerStack() {
  return defaultStackForBlinds(document.getElementById("blinds")?.value || "1/2");
}

function applyDefaultStacksBeforeAction() {
  if (state.actions.some(action => !action.forced || action.manual)) return;
  const stack = defaultPlayerStack();
  state.seats.forEach(player => {
    if (player) player.stack = stack;
  });
}

const state = {
  step: -1,
  streetIndex: 0,
  playerCount: 9,
  selectedSeat: null,
  selectedAction: "raise",
  actionTouched: false,
  startConfig: {
    active: false,
    step: "dealer",
    dealerSeat: 0,
    heroSeat: 0,
    selectedCard: 0,
    cards: [
      { rank: "A", suit: "s" },
      { rank: "K", suit: "h" }
    ]
  },
  dealTarget: null,
  dealCards: [],
  selectedDealCard: 0,
  board: {
    flop: "",
    turn: "",
    river: ""
  },
  activeTab: "analysis",
  session: null,
  lastReviewText: "",
  lastReviewPayload: null,
  lastReviewRecordId: "",
  seats: buildSeats(9),
  actions: []
};

const $ = (id) => document.getElementById(id);
const scrollLock = {
  count: 0,
  y: 0
};

function lockPageScroll() {
  if (scrollLock.count === 0) {
    scrollLock.y = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollLock.y}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    document.body.classList.add("dialog-scroll-locked");
  }
  scrollLock.count += 1;
}

function unlockPageScroll() {
  scrollLock.count = Math.max(0, scrollLock.count - 1);
  if (scrollLock.count > 0) return;
  document.body.classList.remove("dialog-scroll-locked");
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  window.scrollTo(0, scrollLock.y);
}

function showDialog(dialog) {
  if (!dialog || dialog.open) return;
  lockPageScroll();
  dialog.dataset.scrollLocked = "true";
  dialog.showModal();
}

function closeDialog(dialog) {
  if (!dialog?.open) return;
  dialog.close();
}

function handleDialogClosed(dialog) {
  if (dialog.dataset.scrollLocked !== "true") return;
  delete dialog.dataset.scrollLocked;
  unlockPageScroll();
}

function scrollHomeToTop() {
  setActiveTab("analysis");
  window.scrollTo(0, 0);
  window.setTimeout(() => window.scrollTo(0, 0), 0);
}

function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) || fallback;
  } catch (error) {
    return fallback;
  }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

async function apiJson(path, options = {}) {
  const { timeoutMs = 0, ...fetchOptions } = options;
  const controller = timeoutMs > 0 ? new AbortController() : null;
  const timer = controller ? window.setTimeout(() => controller.abort(), timeoutMs) : null;
  let response;
  try {
    response = await fetch(path, {
      credentials: "same-origin",
      ...fetchOptions,
      signal: controller?.signal || fetchOptions.signal,
      headers: {
        "Content-Type": "application/json",
        ...(fetchOptions.headers || {})
      }
    });
  } catch (error) {
    if (error?.name === "AbortError") throw new Error("分析请求超时，请稍后重试或检查模型服务状态。");
    throw error;
  } finally {
    if (timer) window.clearTimeout(timer);
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败，HTTP ${response.status}`);
  return data;
}

function renderAuthState() {
  const user = state.session?.user || null;
  $("loginPage").hidden = Boolean(user);
  $("analysisPage").classList.toggle("auth-locked", !user);
  $("adminPanel").hidden = !user?.isAdmin;
  if (!user) {
    $("accountStatus").innerHTML = `
      <strong>未登录</strong>
      <span>请先登录后使用牌谱分析</span>
    `;
    return;
  }
  $("accountStatus").innerHTML = `
    <strong>${escapeHtml(user.nickname || "已登录用户")}</strong>
    <span>${user.isMember ? "会员权限已开通" : "还不是会员，请联系管理员开通"}${user.isAdmin ? " · 管理员" : ""}</span>
  `;
  if (user.isAdmin) loadAdminDashboard().catch(() => null);
}

async function refreshSession() {
  state.session = await apiJson("/api/session");
  const loginError = new URLSearchParams(location.search).get("login");
  if (loginError) {
    $("loginMessage").textContent = `登录失败：${loginError}`;
  } else if (!state.session.passwordLoginEnabled && !state.session.adminLoginEnabled) {
    $("loginMessage").textContent = "登录方式还没配置。";
  }
  renderAuthState();
}

async function accountLogin() {
  try {
    const username = $("loginUsername").value.trim();
    const password = $("loginPassword").value;
    if (!username || !password) {
      $("loginMessage").textContent = "请输入账号和密码。";
      return;
    }
    const data = await apiJson("/api/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    state.session = { user: data.user };
    $("loginPassword").value = "";
    $("loginMessage").textContent = "";
    renderAuthState();
    scrollHomeToTop();
  } catch (error) {
    $("loginMessage").textContent = friendlyLoginError(error);
  }
}

async function adminLogin() {
  try {
    const code = $("adminCode").value.trim();
    if (!code) {
      $("loginMessage").textContent = "请输入管理员登录码。";
      return;
    }
    const data = await apiJson("/api/dev-login", {
      method: "POST",
      body: JSON.stringify({ code })
    });
    state.session = { user: data.user };
    $("loginMessage").textContent = "";
    renderAuthState();
    scrollHomeToTop();
  } catch (error) {
    $("loginMessage").textContent = friendlyLoginError(error);
  }
}

function friendlyLoginError(error) {
  const message = error?.message || "登录失败";
  if (message.includes("Failed to fetch") || message.includes("Load failed")) {
    return "后端服务没有启动。请在项目目录执行 npm start 后再打开网页。";
  }
  if (message.includes("HTTP 404")) {
    return "当前打开的是静态页面，不是后端服务地址。请用 npm start 启动后访问 http://localhost:4177。";
  }
  return message;
}

async function logout() {
  await apiJson("/api/logout", { method: "POST", body: "{}" }).catch(() => null);
  state.session = { user: null };
  renderAuthState();
}

function memberUntilText(value) {
  if (!value) return "未开通";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未开通";
  return date.getFullYear() > 2090 ? "长期会员" : `到期 ${date.toLocaleDateString("zh-CN")}`;
}

function compactDateTime(value) {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "暂无";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function dateInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getFullYear() > 2090) return "";
  return date.toISOString().slice(0, 10);
}

async function loadAdminDashboard() {
  await Promise.all([loadAdminSettings(), loadAdminUsers()]);
}

async function loadAdminSettings() {
  if (!state.session?.user?.isAdmin) return;
  const data = await apiJson("/api/admin/settings");
  const settings = data.settings || {};
  $("apiKeyStatus").innerHTML = `
    <strong>${settings.deepSeekConfigured ? "API Key 已配置" : "API Key 未配置"}</strong>
    <span>${settings.deepSeekApiKeyMasked ? `当前：${escapeHtml(settings.deepSeekApiKeyMasked)}` : "请配置后端调用模型的 Key"} · 模型 ${escapeHtml(settings.deepSeekModel || "未设置")}</span>
  `;
  $("adminModel").value = settings.deepSeekModel || "deepseek-v4-pro";
}

async function saveAdminSettings() {
  const data = await apiJson("/api/admin/settings", {
    method: "POST",
    body: JSON.stringify({
      deepSeekApiKey: $("adminApiKey").value.trim(),
      deepSeekModel: $("adminModel").value.trim()
    })
  });
  $("adminApiKey").value = "";
  const settings = data.settings || {};
  $("apiKeyStatus").innerHTML = `
    <strong>${settings.deepSeekConfigured ? "API Key 已配置" : "API Key 未配置"}</strong>
    <span>${settings.deepSeekApiKeyMasked ? `当前：${escapeHtml(settings.deepSeekApiKeyMasked)}` : "请配置后端调用模型的 Key"} · 模型 ${escapeHtml(settings.deepSeekModel || "未设置")}</span>
  `;
}

async function loadAdminUsers() {
  if (!state.session?.user?.isAdmin) return;
  const data = await apiJson("/api/admin/users");
  const users = data.users || [];
  const normalUsers = users.filter(user => !user.isAdmin);
  const paidUsers = normalUsers.filter(user => user.isMember);
  const unpaidUsers = normalUsers.filter(user => !user.isMember);
  $("adminUserSummary").innerHTML = `
    <span>注册用户 ${normalUsers.length}</span>
    <span>已付费 ${paidUsers.length}</span>
    <span>未付费 ${unpaidUsers.length}</span>
  `;
  $("adminUserList").innerHTML = users.length ? users.map(user => `
    <article class="admin-user">
      <div>
        <strong>${escapeHtml(user.nickname || user.openid)}${user.isAdmin ? "（管理员）" : ""}</strong>
        <span>${user.username ? `账号 ${escapeHtml(user.username)} · ` : ""}${escapeHtml(user.openid)}</span>
        <span>${escapeHtml(user.isAdmin ? "管理员账号" : user.isMember ? "已付费会员" : "未付费用户")} · ${escapeHtml(memberUntilText(user.memberUntil))}</span>
        <span>注册 ${escapeHtml(compactDateTime(user.createdAt))} · 最近登录 ${escapeHtml(compactDateTime(user.lastLoginAt))}</span>
      </div>
      ${user.isAdmin ? "<em>管理员</em>" : `
        <div class="admin-user-actions">
          <input type="date" value="${escapeHtml(dateInputValue(user.memberUntil))}" data-member-date="${escapeHtml(user.openid)}">
          <button type="button" data-save-member="${escapeHtml(user.openid)}">保存</button>
          <button type="button" data-grant-member="${escapeHtml(user.openid)}">30天</button>
          <button type="button" class="danger-text" data-delete-user="${escapeHtml(user.openid)}">删除</button>
        </div>
      `}
    </article>
  `).join("") : `<div class="empty-state">还没有用户登录过。用户使用账号密码登录后，会自动出现在这里。</div>`;
  if (users.length === 1 && users[0].isAdmin) {
    $("adminUserList").innerHTML += `<div class="empty-state">目前只有管理员账号。其他用户使用账号密码登录后，会出现在这里，你就可以编辑会员有效期或删除用户。</div>`;
  }
}

async function grantMember(openid) {
  await apiJson("/api/admin/grant-member", {
    method: "POST",
    body: JSON.stringify({ openid, days: 30 })
  });
  await loadAdminUsers();
}

async function updateMember(openid) {
  const input = [...document.querySelectorAll("[data-member-date]")]
    .find(item => item.dataset.memberDate === openid);
  await apiJson("/api/admin/update-member", {
    method: "POST",
    body: JSON.stringify({ openid, memberUntil: input?.value || "" })
  });
  await loadAdminUsers();
}

async function deleteRegisteredUser(openid) {
  if (!confirm("确认删除这个注册用户？删除后该用户需要重新登录。")) return;
  await apiJson("/api/admin/delete-user", {
    method: "POST",
    body: JSON.stringify({ openid })
  });
  await loadAdminUsers();
}

function ensureMemberForReview() {
  const user = state.session?.user;
  if (!user) {
    renderAuthState();
    $("loginMessage").textContent = "请先登录。";
    return false;
  }
  if (!user.isMember) {
    renderReviewError("当前账号还不是会员，请联系管理员开通后再使用牌谱分析。");
    return false;
  }
  return true;
}

function escapeHtml(text = "") {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatDateTime(value) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function isSystemPlayerId(id = "") {
  return /^P\d+$/.test(String(id).trim());
}

function normalizePlayerId(id = "") {
  return String(id).trim();
}

function playerRecordKey(id = "") {
  return normalizePlayerId(id).toLocaleLowerCase("zh-CN");
}

function mergePlayerRecords(records = {}) {
  return Object.values(records).reduce((merged, player) => {
    if (!player?.id) return merged;
    const key = playerRecordKey(player.id);
    if (!key) return merged;
    const previous = merged[key];
    if (!previous) {
      merged[key] = {
        ...player,
        id: player.id,
        hands: Array.isArray(player.hands) ? player.hands : [],
        handCount: playerHandCount(player)
      };
      return merged;
    }
    const hands = [
      ...(Array.isArray(player.hands) ? player.hands : []),
      ...(Array.isArray(previous.hands) ? previous.hands : [])
    ].reduce((list, hand) => {
      if (!hand?.favoriteId || list.some(item => item.favoriteId === hand.favoriteId)) return list;
      list.push(hand);
      return list;
    }, []).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    merged[key] = {
      ...previous,
      ...player,
      id: player.id || previous.id,
      firstSeenAt: [previous.firstSeenAt, player.firstSeenAt].filter(Boolean).sort()[0] || previous.firstSeenAt || player.firstSeenAt,
      lastSeenAt: [previous.lastSeenAt, player.lastSeenAt].filter(Boolean).sort().pop() || previous.lastSeenAt || player.lastSeenAt,
      baselineText: player.baselineText || previous.baselineText,
      analysisText: player.analysisText || previous.analysisText,
      baselineHandCount: Math.max(Number(previous.baselineHandCount || 0), Number(player.baselineHandCount || 0)),
      hands,
      handCount: hands.length
    };
    return merged;
  }, {});
}

function playerDisplayName(player) {
  if (!player) return "";
  return isSystemPlayerId(player.id) ? `玩家 ${player.id}` : `ID ${player.id}`;
}

function parseCards(text) {
  return text.trim().split(/\s+/).filter(Boolean).map(raw => {
    const value = raw.slice(0, -1).toUpperCase();
    const suit = raw.slice(-1).toLowerCase();
    const suitMap = { s: "♠", h: "♥", d: "♦", c: "♣" };
    return { label: `${value}${suitMap[suit] || suit}`, red: suit === "h" || suit === "d" };
  });
}

function cardHtml(card) {
  return `<div class="card ${card.red ? "red" : ""}">${card.label}</div>`;
}

function boardForStreet(street) {
  const cards = [];
  if (["Flop", "Turn", "River"].includes(street)) cards.push(...parseCards(state.board.flop));
  if (["Turn", "River"].includes(street)) cards.push(...parseCards(state.board.turn));
  if (street === "River") cards.push(...parseCards(state.board.river));
  return cards;
}

function amountFor(action) {
  return ["raise", "call", "blind", "ante", "straddle", "allin", "fold"].includes(action.type) ? Number(action.amount || 0) : 0;
}

function actionStreetTarget(action) {
  if (Number.isFinite(Number(action.targetAmount))) return Number(action.targetAmount);
  if (Number.isFinite(Number(action.callToAmount))) return Number(action.callToAmount);
  return amountFor(action);
}

function totalsUntil(step) {
  const totals = {};
  const visible = state.actions.slice(0, step + 1);
  const pot = visible.reduce((sum, action) => {
    const amount = amountFor(action);
    totals[action.seatIndex] = (totals[action.seatIndex] || 0) + amount;
    return sum + amount;
  }, 0);
  return { pot, totals };
}

function currentStreet() {
  return streets[state.streetIndex];
}

function actionLabel(action) {
  const position = action.position ? `${action.position} ` : "";
  const map = {
    raise: "加注",
    call: "跟注",
    check: "过牌",
    fold: "弃牌",
    allin: "All-in",
    ante: "Ante",
    straddle: "鱿鱼",
    blind: action.blind === "SB" ? "小盲" : "大盲"
  };
  if (action.previousAction) {
    const previous = action.previousAction;
    const previousLabel = previous.type === "raise"
      ? `先加注 ${previous.amount}`
      : previous.type === "call"
        ? `先跟注 ${previous.amount}`
        : `先${map[previous.type] || previous.type} ${previous.amount}`;
    const target = actionStreetTarget(action);
    const extra = Math.max(0, target - Number(previous.amount || 0));
    return `${position}${action.playerId} ${previousLabel}，后跟注到 ${target}${extra ? `（补 ${extra}）` : ""}`;
  }
  const amount = ["raise", "call"].includes(action.type) ? actionStreetTarget(action) : amountFor(action);
  if (action.type === "fold") {
    const committed = actionStreetTarget(action);
    return `${position}${action.playerId} ${map[action.type]}${committed > amount ? `（已投入 ${committed}）` : amount ? `（已投入 ${amount}）` : ""}`;
  }
  return `${position}${action.playerId} ${map[action.type]}${amount ? ` ${amount}` : ""}`;
}

function actionSummary(action, increment = amountFor(action)) {
  const map = {
    raise: "下注",
    call: "跟注",
    check: "过牌",
    fold: "弃牌",
    allin: "All-in",
    ante: "Ante",
    straddle: "鱿鱼",
    blind: action.blind === "SB" ? "小盲" : "大盲"
  };
  if (action.previousAction) {
    const target = actionStreetTarget(action);
    const extra = Math.max(0, target - Number(action.previousAction.amount || 0));
    return `跟到 ${target}${extra ? ` 补${extra}` : ""}`;
  }
  if (action.type === "fold") {
    const committed = actionStreetTarget(action);
    return `${map[action.type] || action.type}${committed ? ` 已投入${committed}` : ""}`;
  }
  const displayAmount = ["raise", "call"].includes(action.type) ? actionStreetTarget(action) : increment;
  return `${map[action.type] || action.type}${displayAmount ? ` ${displayAmount}` : ""}`;
}

function actionsWithAmounts(actions = state.actions) {
  const streetTotals = {};
  const totalInvested = {};
  return actions.map(action => {
    const streetKey = `${action.street}:${action.seatIndex}`;
    const previousStreetTotal = streetTotals[streetKey] || 0;
    const totalKey = String(action.seatIndex);
    const previousTotalInvested = totalInvested[totalKey] || 0;
    const playerStack = Number(state.seats[action.seatIndex]?.stack || 0);
    const target = actionStreetTarget(action);
    const previousActionAmount = Number(action.previousAction?.amount || 0);
    const incrementAmount = amountFor(action);
    const committedAmount = Math.max(previousStreetTotal + amountFor(action), target);
    const stackBeforeAction = Math.max(0, playerStack - previousTotalInvested - (action.previousAction ? previousActionAmount : 0));
    const stackAfterAction = Math.max(0, playerStack - previousTotalInvested - amountFor(action));
    const streetTotal = previousStreetTotal + amountFor(action);
    streetTotals[streetKey] = streetTotal;
    totalInvested[totalKey] = previousTotalInvested + amountFor(action);
    return {
      ...action,
      previousAction: action.previousAction || null,
      incrementAmount,
      stackBeforeAction,
      stackAfterAction,
      behindBeforeAction: stackBeforeAction,
      behindAfterAction: stackAfterAction,
      streetTotal,
      summary: actionSummary(action, amountFor(action))
    };
  });
}

function occupiedSeatIndexes() {
  return state.seats
    .map((player, index) => player ? index : null)
    .filter(index => index !== null);
}

function occupiedPlayerCount() {
  return occupiedSeatIndexes().length;
}

function syncPlayerCountControl() {
  if ($("playerCount")) {
    const count = occupiedPlayerCount() || state.playerCount;
    $("playerCount").value = String(Math.min(9, Math.max(2, count)));
  }
}

function resetHandProgress() {
  state.step = -1;
  state.streetIndex = 0;
  state.selectedSeat = null;
  state.selectedAction = "raise";
  state.actionTouched = false;
  state.dealTarget = null;
  state.dealCards = [];
  state.selectedDealCard = 0;
  state.board = { flop: "", turn: "", river: "" };
  state.actions = [];
  state.lastReviewText = "";
  state.lastReviewPayload = null;
  state.lastReviewRecordId = "";
}

function resetHandToStart() {
  resetHandProgress();
  refreshFoldedStates();
  render();
  window.setTimeout(openStartOverlay, 0);
}

function clearBoardFromStreet(index) {
  if (index <= streets.indexOf("Flop")) state.board.flop = "";
  if (index <= streets.indexOf("Turn")) state.board.turn = "";
  if (index <= streets.indexOf("River")) state.board.river = "";
}

function returnToPreviousRound() {
  if (state.streetIndex <= 0) return;
  const removedFromIndex = state.streetIndex;
  state.actions = state.actions.filter(action => streets.indexOf(action.street) < removedFromIndex);
  clearBoardFromStreet(removedFromIndex);
  state.streetIndex -= 1;
  state.dealTarget = null;
  state.dealCards = [];
  state.selectedDealCard = 0;
  refreshFoldedStates();
  state.step = state.actions.length - 1;
  closeDialog($("returnDialog"));
  render();
}

function openReturnDialog() {
  const canReturnPrevious = state.streetIndex > 0;
  $("returnPrevRound").disabled = !canReturnPrevious;
  $("returnPrevRound").textContent = canReturnPrevious ? "返回上一圈" : "翻前不能返回上一圈";
  showDialog($("returnDialog"));
}

function setPlayerCount(count) {
  const nextCount = Math.min(9, Math.max(2, Number(count) || 9));
  state.playerCount = nextCount;
  state.seats = buildSeats(nextCount);
  resetHandProgress();
  applyDefaultStacksBeforeAction();
  syncPlayerCountControl();
  render();
  window.setTimeout(openStartOverlay, 0);
}

function dealerSeatIndex() {
  const dealerIndex = state.seats.findIndex(player => player?.dealer);
  return dealerIndex >= 0 ? dealerIndex : occupiedSeatIndexes()[0];
}

function positionsForSeats() {
  const occupied = occupiedSeatIndexes();
  if (!occupied.length) return {};
  const dealer = dealerSeatIndex();
  const dealerOffset = Math.max(occupied.indexOf(dealer), 0);
  const ordered = occupied.slice(dealerOffset).concat(occupied.slice(0, dealerOffset));
  const labels = positionsByPlayers[ordered.length] || positionsByPlayers[9];
  return ordered.reduce((map, seatIndex, index) => {
    map[seatIndex] = labels[index] || "";
    return map;
  }, {});
}

function setDealer(index) {
  state.seats.forEach((player, seatIndex) => {
    if (player) player.dealer = seatIndex === index;
  });
}

function activeSeatIndexes() {
  return state.seats
    .map((player, index) => player && !player.folded && !seatIsAllIn(index) ? index : null)
    .filter(index => index !== null);
}

function actionsForStreet(street = currentStreet()) {
  return state.actions.filter(action => action.street === street);
}

function streetInvestments(street = currentStreet()) {
  return actionsForStreet(street).reduce((totals, action) => {
    totals[action.seatIndex] = (totals[action.seatIndex] || 0) + amountFor(action);
    return totals;
  }, {});
}

function streetCommittedBySeat(street = currentStreet(), seatIndex = state.selectedSeat, ignoredIndex = -1, beforeIndex = state.actions.length) {
  return state.actions.reduce((total, action, index) => {
    if (
      index >= beforeIndex
      || index === ignoredIndex
      || action.street !== street
      || action.seatIndex !== seatIndex
    ) return total;
    return total + amountFor(action);
  }, 0);
}

function manualActionIndexesForSeat(street = currentStreet(), seatIndex = state.selectedSeat) {
  return state.actions
    .map((action, index) => ({ action, index }))
    .filter(({ action }) => (
      action.street === street
      && action.seatIndex === seatIndex
      && (!action.forced || action.manual)
    ))
    .map(({ index }) => index);
}

function manualActionForSeat(street = currentStreet(), seatIndex = state.selectedSeat) {
  const index = manualActionIndexesForSeat(street, seatIndex)[0];
  return index === undefined ? null : state.actions[index];
}

function investmentsBeforeAction(street, beforeIndex = state.actions.length, ignoredIndex = -1) {
  return state.actions.reduce((totals, action, index) => {
    if (index >= beforeIndex || index === ignoredIndex || action.street !== street) return totals;
    totals[action.seatIndex] = (totals[action.seatIndex] || 0) + amountFor(action);
    return totals;
  }, {});
}

function currentCallAmount(street = currentStreet(), seatIndex = state.selectedSeat, ignoredIndex = -1, beforeIndex = state.actions.length) {
  const investments = investmentsBeforeAction(street, beforeIndex, ignoredIndex);
  const target = Math.max(0, ...Object.values(investments));
  const invested = seatIndex === null || seatIndex === undefined ? 0 : investments[seatIndex] || 0;
  return Math.max(0, target - invested);
}

function investedBySeat(seatIndex, ignoredIndex = -1) {
  return state.actions.reduce((total, action, index) => (
    index === ignoredIndex || action.seatIndex !== seatIndex ? total : total + amountFor(action)
  ), 0);
}

function remainingStackForSeat(seatIndex, ignoredIndex = -1) {
  const stack = Number(state.seats[seatIndex]?.stack || 0);
  return Math.max(0, stack - investedBySeat(seatIndex, ignoredIndex));
}

function seatHasCommittedStack(seatIndex) {
  const player = state.seats[seatIndex];
  if (!player) return false;
  return investedBySeat(seatIndex) >= Number(player.stack || 0);
}

function seatIsAllIn(seatIndex) {
  const player = state.seats[seatIndex];
  if (!player) return false;
  return Boolean(player.allin) || seatHasCommittedStack(seatIndex);
}

function targetAmountForStreet(street = currentStreet(), ignoredIndex = -1) {
  return Math.max(
    0,
    ...state.actions
      .filter((action, index) => (
        index !== ignoredIndex
        && action.street === street
        && !["ante", "check", "fold"].includes(action.type)
      ))
      .map(actionStreetTarget)
  );
}

function targetAmountBeforeAction(street, beforeIndex, ignoredIndex = -1) {
  return Math.max(
    0,
    ...state.actions
      .filter((action, index) => (
        index < beforeIndex
        && index !== ignoredIndex
        && action.street === street
        && !["ante", "check", "fold"].includes(action.type)
      ))
      .map(actionStreetTarget)
  );
}

function callAmountForSeat(street = currentStreet(), seatIndex = state.selectedSeat) {
  const existingIndex = manualActionIndexesForSeat(street, seatIndex)[0] ?? -1;
  if (existingIndex >= 0) {
    return targetAmountForStreet(street, existingIndex);
  }
  return currentCallAmount(street, seatIndex);
}

function legalActionsForSeat(street = currentStreet(), seatIndex = state.selectedSeat) {
  if (seatIndex === null || seatIndex === undefined || seatIsAllIn(seatIndex)) return new Set();
  const existingIndex = manualActionIndexesForSeat(street, seatIndex)[0] ?? -1;
  const callAmount = callAmountForSeat(street, seatIndex);
  const remaining = seatIndex === null || seatIndex === undefined ? 0 : remainingStackForSeat(seatIndex, existingIndex);
  const canStraddle = street === "Preflop" && $("unlimitedStraddle").checked;
  return new Set([
    ...(callAmount <= 0 ? ["check"] : []),
    "fold",
    ...(callAmount > 0 ? ["call"] : []),
    ...(remaining > 0 ? ["raise", "allin"] : []),
    ...(canStraddle && remaining > 0 ? ["straddle"] : [])
  ]);
}

function normalizeStreetCallAmounts(street = currentStreet()) {
  return street;
}

function refreshFoldedStates() {
  state.seats.forEach((player, index) => {
    if (!player) return;
    player.folded = state.actions.some(action => action.seatIndex === index && action.type === "fold");
    player.allin = state.actions.some(action => action.seatIndex === index && action.type === "allin")
      || seatHasCommittedStack(index);
  });
}

function liveSeatIndexes() {
  return state.seats
    .map((player, index) => player && !player.folded ? index : null)
    .filter(index => index !== null);
}

function allLivePlayersAllIn() {
  const live = liveSeatIndexes();
  return live.length > 1 && live.every(index => seatIsAllIn(index));
}

function handEndedByFolds() {
  const live = liveSeatIndexes();
  return live.length <= 1;
}

function allInRunoutReady() {
  const live = liveSeatIndexes();
  if (live.length <= 1) return false;
  const active = live.filter(index => !seatIsAllIn(index));
  if (!active.length) return true;
  if (active.length > 1) return false;
  const target = targetAmountForStreet(currentStreet());
  if (target <= 0) return false;
  const investments = streetInvestments(currentStreet());
  return (investments[active[0]] || 0) >= target;
}

function playersMissingAction(street = currentStreet()) {
  if (handEndedByFolds() || allInRunoutReady()) return [];
  const acted = new Set(actionsForStreet(street).filter(action => !action.forced).map(action => action.seatIndex));
  const investments = streetInvestments(street);
  const target = targetAmountForStreet(street);
  return activeSeatIndexes().filter(index => {
    if (target > 0 && (investments[index] || 0) < target) return true;
    return !acted.has(index);
  });
}

function parseBlindAmounts() {
  const [small, big] = $("blinds").value.split(/[\\s/]+/).map(value => Number(value)).filter(Number.isFinite);
  return { small: small || 1, big: big || 2 };
}

function preflopForcedSettings() {
  const { small, big } = parseBlindAmounts();
  const ante = Math.max(0, Number($("anteAmount").value || 0));
  const finiteStraddle = Math.max(0, Number($("straddleAmount").value || 0));
  return {
    small,
    big,
    ante,
    finiteStraddle
  };
}

function straddleAmount() {
  const { big } = parseBlindAmounts();
  const configured = Math.max(0, Number($("straddleAmount").value || 0));
  return configured || big * 2;
}

function blindSeatIndexes() {
  const positions = positionsForSeats();
  const entries = Object.entries(positions);
  const sbEntry = entries.find(([, position]) => position === "SB" || position === "BTN/SB");
  const bbEntry = entries.find(([, position]) => position === "BB");
  return {
    sb: sbEntry ? Number(sbEntry[0]) : null,
    bb: bbEntry ? Number(bbEntry[0]) : null,
    positions
  };
}

function preflopStraddleSeats(positions) {
  const preflopOrder = ["UTG", "UTG+1", "MP", "LJ", "HJ", "CO", "BTN", "SB", "BB"];
  return Object.entries(positions)
    .filter(([, position]) => !["BTN/SB", "SB", "BB"].includes(position))
    .sort(([, a], [, b]) => preflopOrder.indexOf(a) - preflopOrder.indexOf(b))
    .map(([seatIndex]) => Number(seatIndex));
}

function syncForcedBlinds() {
  if (currentStreet() !== "Preflop") return;
  const { small, big, ante, finiteStraddle } = preflopForcedSettings();
  const { sb, bb, positions } = blindSeatIndexes();
  const manualActions = state.actions.filter(action => !action.forced || action.manual);
  const forced = [];
  if (ante > 0) {
    occupiedSeatIndexes().forEach(seatIndex => {
      forced.push({
        street: "Preflop",
        seatIndex,
        playerId: state.seats[seatIndex].id,
        position: positions[seatIndex],
        type: "ante",
        amount: ante,
        forced: true
      });
    });
  }
  if (sb !== null && state.seats[sb]) {
    forced.push({
      street: "Preflop",
      seatIndex: sb,
      playerId: state.seats[sb].id,
      position: positions[sb],
      type: "blind",
      blind: "SB",
      amount: small,
      forced: true
    });
  }
  if (bb !== null && state.seats[bb]) {
    forced.push({
      street: "Preflop",
      seatIndex: bb,
      playerId: state.seats[bb].id,
      position: positions[bb],
      type: "blind",
      blind: "BB",
      amount: big,
      forced: true
    });
  }
  const straddleSeats = preflopStraddleSeats(positions);
  if (finiteStraddle > 0 && !$("unlimitedStraddle").checked && straddleSeats.length) {
    const seatIndex = straddleSeats[0];
    forced.push({
      street: "Preflop",
      seatIndex,
      playerId: state.seats[seatIndex].id,
      position: positions[seatIndex],
      type: "straddle",
      amount: finiteStraddle,
      forced: true
    });
  }
  state.actions = forced.concat(manualActions);
  if (state.step < forced.length - 1) state.step = forced.length - 1;
}

function cardCode(card) {
  return card.rank && card.suit ? `${card.rank}${card.suit}` : "";
}

function normalizeCardCode(raw = "") {
  const value = String(raw).trim();
  if (!value) return "";
  return `${value.slice(0, -1).toUpperCase()}${value.slice(-1).toLowerCase()}`;
}

function cardDisplay(raw = "") {
  const normalized = normalizeCardCode(raw);
  const parsed = normalized ? parseCards(normalized)[0] : null;
  return parsed?.label || normalized || "未知牌";
}

function selectedBoardCards(excludeStreet = "") {
  return [
    ...(excludeStreet === "Flop" ? [] : state.board.flop.trim().split(/\s+/).filter(Boolean)),
    ...(excludeStreet === "Turn" ? [] : state.board.turn.trim().split(/\s+/).filter(Boolean)),
    ...(excludeStreet === "River" ? [] : state.board.river.trim().split(/\s+/).filter(Boolean))
  ];
}

function duplicateCardMessage(cards) {
  const seen = new Set();
  const duplicate = cards
    .map(normalizeCardCode)
    .filter(Boolean)
    .find(card => {
      if (seen.has(card)) return true;
      seen.add(card);
      return false;
    });
  return duplicate ? `${cardDisplay(duplicate)} 已经被选择，不能重复发同一张牌。` : "";
}

function selectedDeckCards({ includeHero = true, excludeStreet = "", dealCards = [] } = {}) {
  return [
    ...(includeHero ? $("heroCards").value.trim().split(/\s+/).filter(Boolean) : []),
    ...selectedBoardCards(excludeStreet),
    ...dealCards.map(cardCode).filter(Boolean)
  ];
}

function currentDeckError() {
  return duplicateCardMessage(selectedDeckCards());
}

function cardFromCode(raw = "") {
  const value = String(raw).trim();
  return {
    rank: value.slice(0, -1).toUpperCase(),
    suit: value.slice(-1).toLowerCase()
  };
}

function nextStreetName() {
  return streets[state.streetIndex + 1];
}

function heroSeatIndex() {
  const heroIndex = state.seats.findIndex(player => player?.hero);
  return heroIndex >= 0 ? heroIndex : occupiedSeatIndexes()[0];
}

function setHero(index) {
  state.seats.forEach((player, seatIndex) => {
    if (player) player.hero = seatIndex === index;
  });
}

function seatChoiceLabel(index) {
  const positions = positionsForSeats();
  const player = state.seats[index];
  return `${positions[index] || `Seat ${index + 1}`} · ${playerDisplayName(player)}`;
}

function startCardHtml(card, index) {
  const parsed = cardCode(card) ? parseCards(cardCode(card))[0] : null;
  return `
    <button type="button" class="deal-card ${index === state.startConfig.selectedCard ? "selected" : ""}" data-start-card="${index}">
      ${parsed ? cardHtml(parsed) : `<span>第 ${index + 1} 张</span>`}
    </button>
  `;
}

function resetStartConfig() {
  state.startConfig = {
    active: true,
    step: "dealer",
    dealerSeat: dealerSeatIndex(),
    heroSeat: heroSeatIndex(),
    selectedCard: 0,
    cards: [
      { rank: "", suit: "" },
      { rank: "", suit: "" }
    ]
  };
}

function renderStartOverlay() {
  const { active, step, cards, selectedCard } = state.startConfig;
  $("startOverlay").hidden = !active;
  $("seatLayer").classList.toggle("start-card-mode", active && step === "cards");
  if (!active) {
    $("startCardsPanel").hidden = true;
    $("startOverlay").style.display = "none";
    $("startCardsPanel").style.display = "none";
    return;
  }
  $("startOverlay").style.display = "";
  $("startStepLabel").textContent = step === "dealer" ? "第 1 步 / 3" : step === "hero" ? "第 2 步 / 3" : "第 3 步 / 3";
  $("startOverlayTitle").textContent = step === "dealer" ? "请选择 BTN 玩家位置" : step === "hero" ? "请选择第一视角玩家位置" : "请选择第一视角手牌";
  $("startOverlayHint").textContent = step === "dealer"
    ? "直接点击牌桌上的玩家，选中后 BTN 会亮起"
    : step === "hero"
      ? "BTN 已锁定，请点击你要分析的第一视角玩家"
      : "先选择牌面数字，再选择花色";
  $("startCardsPanel").hidden = step !== "cards";
  $("startCardsPanel").style.display = step === "cards" ? "" : "none";
  $("startHoleCards").innerHTML = cards.map(startCardHtml).join("");
  $("startRankPicker").innerHTML = ranks.map(rank => `
    <button type="button" data-start-rank="${rank}" class="${cards[selectedCard]?.rank === rank ? "selected" : ""}">${rank}</button>
  `).join("");
  $("startSuitPicker").innerHTML = suits.map(suit => `
    <button type="button" data-start-suit="${suit.code}" class="${cards[selectedCard]?.suit === suit.code ? "selected" : ""}">${suit.label}<span>${suit.name}</span></button>
  `).join("");
}

function closeStartOverlay() {
  state.startConfig.active = false;
  $("startOverlay").hidden = true;
  $("startCardsPanel").hidden = true;
  $("startOverlay").style.display = "none";
  $("startCardsPanel").style.display = "none";
  $("seatLayer").classList.remove("start-card-mode");
  $("startHoleCards").innerHTML = "";
  $("startRankPicker").innerHTML = "";
  $("startSuitPicker").innerHTML = "";
}

function openStartOverlay() {
  resetStartConfig();
  render();
}

function handleStartSeatPick(index) {
  const player = state.seats[index];
  if (!player) return;
  if (state.startConfig.step === "dealer") {
    state.startConfig.dealerSeat = index;
    setDealer(index);
    state.startConfig.step = "hero";
    render();
    return;
  }
  if (state.startConfig.step === "hero") {
    state.startConfig.heroSeat = index;
    setHero(index);
    state.startConfig.step = "cards";
    render();
  }
}

function confirmStartCards() {
  const complete = state.startConfig.cards.every(card => card.rank && card.suit);
  if (!complete) {
    $("startOverlayTitle").textContent = "请先选完整手牌";
    return;
  }
  const duplicateMessage = duplicateCardMessage(state.startConfig.cards.map(cardCode));
  if (duplicateMessage) {
    $("startOverlayTitle").textContent = duplicateMessage;
    return;
  }
  $("heroCards").value = state.startConfig.cards.map(cardCode).join(" ");
  setDealer(state.startConfig.dealerSeat);
  setHero(state.startConfig.heroSeat);
  closeStartOverlay();
  render();
}

function advanceStartCardSelection() {
  const duplicateMessage = duplicateCardMessage(state.startConfig.cards.map(cardCode));
  if (duplicateMessage) {
    $("startOverlayTitle").textContent = duplicateMessage;
    renderStartOverlay();
    $("startOverlayTitle").textContent = duplicateMessage;
    return;
  }
  const cards = state.startConfig.cards;
  if (cards.every(card => card.rank && card.suit)) {
    confirmStartCards();
    return;
  }
  if (state.startConfig.selectedCard === 0 && cards[0].rank && cards[0].suit) {
    state.startConfig.selectedCard = 1;
  }
  renderStartOverlay();
}

function warnDuplicateDealCard() {
  const duplicateMessage = duplicateCardMessage(selectedDeckCards({
    excludeStreet: state.dealTarget,
    dealCards: state.dealCards
  }));
  if (!duplicateMessage) return false;
  $("dealTitle").textContent = duplicateMessage;
  return true;
}

function seatStreetAction(index) {
  return [...state.actions]
    .reverse()
    .find(action => (
      action.street === currentStreet()
      && action.seatIndex === index
      && (!action.forced || action.manual)
    ));
}

function renderSeats() {
  const { totals } = totalsUntil(Math.max(state.step, -1));
  const positions = positionsForSeats();
  const tablePositions = window.matchMedia("(max-width: 430px)").matches ? compactSeatPositions : seatPositions;
  $("seatLayer").innerHTML = state.seats.map((player, index) => {
    const [x, y] = tablePositions[index];
    if (!player) {
      return `
        <button class="seat empty" data-seat="${index}" style="left:${x}%;top:${y}%">
        <strong>空闲位置</strong>
        <span>点击添加</span>
        </button>
      `;
    }

    const left = Math.max(0, Number(player.stack) - (totals[index] || 0));
    const cards = player.hero
      ? parseCards($("heroCards").value).map(cardHtml).join("")
      : `<div class="card back">?</div><div class="card back">?</div>`;
    const streetAction = seatStreetAction(index);
    const actionBadge = streetAction ? `
        <div class="seat-action ${["raise", "call", "allin", "straddle"].includes(streetAction.type) ? "with-chip" : ""}">
          <i aria-hidden="true"></i>
          <span>${actionSummary(streetAction)}</span>
        </div>
      ` : "";
    const startClasses = state.startConfig.active
      ? `${state.startConfig.step === "dealer" ? "start-pickable" : ""} ${state.startConfig.step === "hero" ? "start-pickable" : ""} ${index === state.startConfig.dealerSeat && state.startConfig.step !== "dealer" ? "start-locked" : ""} ${index === state.startConfig.heroSeat && state.startConfig.step === "cards" ? "start-locked" : ""} ${state.startConfig.step !== "cards" ? "start-muted" : ""}`
      : "";
    return `
      <button class="seat ${player.hero ? "hero" : ""} ${player.dealer ? "dealer" : ""} ${player.folded ? "folded" : ""} ${player.allin ? "allin" : ""} ${startClasses}" data-seat="${index}" style="left:${x}%;top:${y}%">
        <div class="seat-head">
          <strong>${playerDisplayName(player)}</strong>
          <span class="position-badge">${positions[index] || ""}</span>
        </div>
        <span>剩余 ${left}</span>
        <span class="style-pill">${player.style}</span>
        <div class="cards">${cards}</div>
        ${actionBadge}
      </button>
    `;
  }).join("");
}

function renderTimeline() {
  $("timeline").innerHTML = state.actions.map((action, index) => `
    <li class="${index === state.step ? "active" : ""}">
      <small>${action.street}</small>
      <span>${actionLabel(action)}</span>
      ${action.forced && !action.manual ? "<em>强制</em>" : `<button data-remove-action="${index}" title="删除行动">×</button>`}
    </li>
  `).join("");
}

function render() {
  syncForcedBlinds();
  const street = currentStreet();
  const current = state.step >= 0 ? state.actions[state.step] : null;
  const { pot } = totalsUntil(Math.max(state.step, -1));

  $("streetLabel").textContent = `${street} · ${$("blinds").value}`;
  $("currentAction").textContent = current ? actionLabel(current) : "点击玩家记录行动或编辑玩家";
  $("boardCards").innerHTML = boardForStreet(street).map(cardHtml).join("");
  $("potSize").textContent = pot;
  $("stepCount").textContent = `${Math.max(state.step + 1, 0)}/${state.actions.length}`;
  syncPlayerCountControl();
  renderSeats();
  renderTimeline();
  renderStartOverlay();
}

function openSeatDialog(index) {
  state.selectedSeat = index;
  state.selectedAction = "raise";
  state.actionTouched = false;
  const player = state.seats[index];
  const positions = positionsForSeats();
  const existingAction = manualActionForSeat(currentStreet(), index);
  $("dialogSeat").textContent = player ? `Seat ${index + 1} · ${positions[index] || ""}` : `Seat ${index + 1} · 空位`;
  $("dialogTitle").textContent = player ? playerDisplayName(player) : "空闲位置";
  $("occupiedTools").hidden = !player;
  $("emptyTools").hidden = Boolean(player);

  if (player) {
    if (existingAction) state.selectedAction = existingAction.type;
    $("playerStack").value = player.stack;
    $("playerStyle").value = player.style;
    $("playerId").value = player.id;
    $("playerDealer").checked = Boolean(player.dealer);
    $("actionAmount").value = existingAction?.type === "raise"
      ? existingAction.amount
      : callAmountForSeat(currentStreet(), index) || 6;
    updateActionAmountVisibility();
  } else {
    $("newPlayerId").value = `P${index + 1}`;
    $("newPlayerStack").value = defaultPlayerStack();
    $("newPlayerStyle").value = "普通";
  }

  showDialog($("seatDialog"));
}

function updateActionAmountVisibility() {
  const existingIndex = manualActionIndexesForSeat(currentStreet(), state.selectedSeat)[0] ?? -1;
  const callAmount = callAmountForSeat(currentStreet(), state.selectedSeat);
  const allinAmount = state.selectedSeat === null ? 0 : remainingStackForSeat(state.selectedSeat, existingIndex);
  const legalActions = legalActionsForSeat(currentStreet(), state.selectedSeat);
  const canStraddle = currentStreet() === "Preflop" && $("unlimitedStraddle").checked;
  if (!canStraddle && state.selectedAction === "straddle") state.selectedAction = "raise";
  if (!legalActions.size) {
    state.selectedAction = "";
  } else if (!legalActions.has(state.selectedAction)) {
    state.selectedAction = legalActions.has("call")
      ? "call"
      : legalActions.has("check")
        ? "check"
        : legalActions.has("allin")
          ? "allin"
          : "fold";
  }
  $("amountWrap").hidden = state.selectedAction !== "raise";
  $("callHint").textContent = callAmount > 0 ? `自动跟注 ${callAmount}` : "当前无人下注，跟注为 0";
  $("allinHint").textContent = `投入 ${allinAmount}`;
  $("straddleAction").hidden = !canStraddle;
  $("straddleHint").textContent = `记录 ${straddleAmount()}`;
  $("recordAction").disabled = !legalActions.size;
  $("recordAction").textContent = !legalActions.size
    ? "玩家已 All-in"
    : state.selectedAction === "call"
    ? `记录跟注 ${callAmount}`
    : state.selectedAction === "allin"
      ? `记录 All-in ${allinAmount}`
    : state.selectedAction === "straddle"
      ? `记录鱿鱼 ${straddleAmount()}`
      : "记录行动";
  document.querySelectorAll("[data-action]").forEach(button => {
    const legal = legalActions.has(button.dataset.action);
    button.disabled = !legal;
    button.setAttribute("aria-disabled", String(!legal));
    button.classList.toggle("selected", button.dataset.action === state.selectedAction);
  });
}

function potBeforeSelectedAction() {
  const existingIndex = manualActionIndexesForSeat(currentStreet(), state.selectedSeat)[0] ?? -1;
  return totalsUntil(existingIndex >= 0 ? existingIndex - 1 : state.actions.length - 1).pot;
}

function applyPotShortcut(ratio) {
  if (state.selectedAction !== "raise") {
    state.selectedAction = "raise";
    updateActionAmountVisibility();
  }
  const pot = potBeforeSelectedAction();
  const callAmount = callAmountForSeat(currentStreet(), state.selectedSeat);
  const amount = Math.max(callAmount, Math.round(pot * ratio));
  $("actionAmount").value = amount;
}

function addAction(type) {
  const index = state.selectedSeat;
  applyPlayerEdits();
  const player = state.seats[index];
  if (!player) return;
  const positions = positionsForSeats();
  const street = currentStreet();
  if (!legalActionsForSeat(street, index).has(type)) {
    $("currentAction").textContent = "该动作当前不可用";
    return;
  }
  const existingIndexes = manualActionIndexesForSeat(street, index);
  const existingIndex = existingIndexes[0] ?? -1;
  const existingAction = existingIndex >= 0 ? state.actions[existingIndex] : null;
  const actionIndex = existingIndex >= 0 ? existingIndex : state.actions.length;
  const committedBeforeAction = streetCommittedBySeat(street, index, existingIndex, actionIndex);
  const previousCommitted = existingAction ? committedBeforeAction + amountFor(existingAction) : committedBeforeAction;
  const previousAction = type === "call" && existingAction && !["call", "check", "fold"].includes(existingAction.type)
    ? {
        type: existingAction.previousAction?.type || existingAction.type,
        amount: existingAction.previousAction?.amount || previousCommitted
      }
    : type === "call" && existingAction?.type === "call" && callAmountForSeat(street, index) > actionStreetTarget(existingAction)
      ? {
          type: "call",
          amount: existingAction.callToAmount || actionStreetTarget(existingAction)
        }
    : type === "call" && existingAction?.previousAction
      ? existingAction.previousAction
      : null;
  const callTarget = type === "call"
    ? existingIndex >= 0
      ? callAmountForSeat(street, index)
      : committedBeforeAction + callAmountForSeat(street, index)
    : 0;
  const raiseTarget = type === "raise" ? Math.max(0, Number($("actionAmount").value || 0)) : 0;
  const actionAmount = type === "raise"
    ? Math.max(0, raiseTarget - committedBeforeAction)
    : type === "call"
      ? Math.max(0, callTarget - committedBeforeAction)
      : type === "allin"
        ? remainingStackForSeat(index, existingIndex)
      : type === "straddle"
        ? straddleAmount()
        : type === "fold" && existingAction
          ? amountFor(existingAction)
          : 0;
  const targetAmount = type === "raise"
    ? raiseTarget
    : type === "call"
      ? callTarget
      : type === "allin" || type === "straddle" || type === "fold"
        ? committedBeforeAction + actionAmount
        : committedBeforeAction;
  const action = {
    street: currentStreet(),
    seatIndex: index,
    playerId: player.id,
    position: positions[index],
    type,
    forced: type === "straddle",
    manual: type === "straddle",
    amount: actionAmount,
    targetAmount
  };
  if (previousAction) {
    action.previousAction = previousAction;
    action.callToAmount = callTarget;
  }
  if (existingIndex >= 0) {
    state.actions[existingIndex] = action;
    const duplicateIndexes = new Set(existingIndexes.slice(1));
    state.actions = state.actions.filter((_, actionIndex) => !duplicateIndexes.has(actionIndex));
    state.step = Math.min(existingIndex, state.actions.length - 1);
  } else {
    state.actions.push(action);
    state.step = state.actions.length - 1;
  }
  normalizeStreetCallAmounts(street);
  refreshFoldedStates();
  closeDialog($("seatDialog"));
  if (handEndedByFolds()) {
    render();
    $("currentAction").textContent = "只剩一名未弃牌玩家，本手牌行动已结束，可以进行牌谱分析";
    return;
  }
  if (allInRunoutReady() && street !== "River") {
    render();
    openDealDialog();
    return;
  }
  render();
}

function confirmBackdropAction() {
  const quickActions = ["call", "check", "fold", "straddle", "allin"];
  if (!$("seatDialog").open || $("occupiedTools").hidden) return;
  if (!state.actionTouched || !quickActions.includes(state.selectedAction)) return;
  addAction(state.selectedAction);
}

function renderDealCards() {
  $("dealCards").innerHTML = state.dealCards.map((card, index) => {
    const parsed = cardCode(card) ? parseCards(cardCode(card))[0] : null;
    return `
      <button type="button" class="deal-card ${index === state.selectedDealCard ? "selected" : ""}" data-deal-card="${index}">
        ${parsed ? cardHtml(parsed) : `<span>第 ${index + 1} 张</span>`}
      </button>
    `;
  }).join("");

  $("rankPicker").innerHTML = ranks.map(rank => `
    <button type="button" data-rank="${rank}" class="${state.dealCards[state.selectedDealCard]?.rank === rank ? "selected" : ""}">${rank}</button>
  `).join("");

  $("suitPicker").innerHTML = suits.map(suit => `
    <button type="button" data-suit="${suit.code}" class="${state.dealCards[state.selectedDealCard]?.suit === suit.code ? "selected" : ""}">${suit.label}<span>${suit.name}</span></button>
  `).join("");
}

function openDealDialog() {
  const target = nextStreetName();
  if (!target) return;
  const count = target === "Flop" ? 3 : 1;
  const boardKey = target.toLowerCase();
  const source = target === "Flop" ? state.board.flop.trim().split(/\s+/).filter(Boolean) : [state.board[boardKey].trim()].filter(Boolean);
  state.dealTarget = target;
  state.selectedDealCard = 0;
  state.dealCards = Array.from({ length: count }, (_, index) => {
    const raw = source[index] || "";
    return { rank: raw.slice(0, -1).toUpperCase(), suit: raw.slice(-1).toLowerCase() };
  });
  $("dealStreetLabel").textContent = `${currentStreet()} 完成`;
  $("dealTitle").textContent = target === "Flop" ? "发翻牌" : target === "Turn" ? "发转牌" : "发河牌";
  renderDealCards();
  showDialog($("dealDialog"));
}

function confirmDeal() {
  if (!state.dealTarget) return;
  const complete = state.dealCards.every(card => card.rank && card.suit);
  if (!complete) {
    $("dealTitle").textContent = "请先选完整牌面";
    return;
  }
  const duplicateMessage = duplicateCardMessage(selectedDeckCards({
    excludeStreet: state.dealTarget,
    dealCards: state.dealCards
  }));
  if (duplicateMessage) {
    $("dealTitle").textContent = duplicateMessage;
    return;
  }
  const cards = state.dealCards.map(cardCode).join(" ");
  if (state.dealTarget === "Flop") state.board.flop = cards;
  if (state.dealTarget === "Turn") state.board.turn = cards;
  if (state.dealTarget === "River") state.board.river = cards;
  state.streetIndex = streets.indexOf(state.dealTarget);
  state.step = state.actions.length - 1;
  closeDialog($("dealDialog"));
  render();
  if (allInRunoutReady()) {
    if (currentStreet() === "River") {
      $("currentAction").textContent = "河牌已发完，可以进行牌谱分析";
      openReviewConfirm("河牌已发完，本手牌可以开始牌谱分析。");
    } else {
      window.setTimeout(openDealDialog, 0);
    }
  }
}

function boardSummary() {
  return {
    flop: state.board.flop.trim(),
    turn: state.board.turn.trim(),
    river: state.board.river.trim()
  };
}

function missingActionSummary(street = currentStreet()) {
  const positions = positionsForSeats();
  const investments = streetInvestments(street);
  const target = targetAmountForStreet(street);
  return playersMissingAction(street).map(index => ({
    seat: index + 1,
    position: positions[index],
    playerId: state.seats[index]?.id || "",
    reason: target > 0 && (investments[index] || 0) < target
      ? `该玩家当前街已投入 ${investments[index] || 0}，需要对 ${target} 的目标金额重新决策`
      : "该玩家在当前街还没有主动行动记录"
  }));
}

function handPayload() {
  const positions = positionsForSeats();
  const { pot, totals } = totalsUntil(state.actions.length - 1);
  const enrichedActions = actionsWithAmounts();
  const anteAmount = Number($("anteAmount").value || 0);
  return {
    gameProfile: {
      environment: "线下娱乐局",
      analysisPriority: "实战盈利与玩家倾向优先，GTO 仅作补充参考",
      handStrengthRule: "分析前必须精确比较五张最佳牌；例如 Hero AK 在 A-K-8-4-5 上是 AAKK8，压制 A8 的 AA88K，A8 不是能赢 Hero AK 的组合",
      normalPreflopOpenRangeBB: "3-20BB",
      openSizeRule: "3BB 到 20BB 的翻前 open 在本局型中都属于正常尺度，不能仅因数值大于常规线上尺度而判定异常",
      anteRule: "Ante 不是固定 1，而是由用户按当前级别填写的实际筹码额；例如 2/4、3/6、5/5 级别下 ante 数额可能不同",
      configuredAnteAmount: anteAmount,
      anteIsCommon: true,
      straddleMode: "无限鱿鱼 / 血战鱿鱼",
      straddleIsCommon: true,
      sizingBaseline: "以本局 ante、鱿鱼、有效筹码、SPR、玩家倾向和现场尺度为基准，不以常规线上 2-3BB open 作为主要评判基准"
    },
    playerCount: occupiedPlayerCount(),
    blinds: $("blinds").value,
    ante: anteAmount,
    straddle: {
      finiteAmount: Number($("straddleAmount").value || 0),
      unlimited: $("unlimitedStraddle").checked
    },
    currentStreet: currentStreet(),
    missingActionsOnCurrentStreet: missingActionSummary(currentStreet()),
    pot,
    heroCards: $("heroCards").value.trim(),
    board: boardSummary(),
    players: state.seats.map((player, index) => player ? {
      seat: index + 1,
      id: player.id,
      position: positions[index],
      stack: player.stack,
      invested: totals[index] || 0,
      remaining: Math.max(0, Number(player.stack) - (totals[index] || 0)),
      style: player.style,
      hero: player.hero,
      dealer: player.dealer,
      folded: player.folded
    } : {
      seat: index + 1,
      empty: true
    }),
    actionsByStreet: streets.reduce((grouped, street) => {
      grouped[street] = enrichedActions
        .filter(action => action.street === street)
        .map(action => ({
          position: action.position,
          playerId: action.playerId,
          type: action.type,
          label: actionLabel(action),
          summary: action.summary,
          isPlayerDecision: !action.forced || Boolean(action.manual),
          actionKind: action.forced && !action.manual ? "forced_post" : "player_decision",
          forcedMeaning: action.forced && !action.manual ? "强制投入，例如 ante / SB / BB；这不是玩家主动决策" : "",
          amount: amountFor(action),
          targetAmount: actionStreetTarget(action),
          incrementAmount: action.incrementAmount,
          stackBeforeAction: action.stackBeforeAction,
          stackAfterAction: action.stackAfterAction,
          behindBeforeAction: action.behindBeforeAction,
          behindAfterAction: action.behindAfterAction,
          previousAction: action.previousAction,
          forced: Boolean(action.forced)
        }));
      return grouped;
    }, {})
  };
}

function reviewPrompt(payload) {
  return [
    "你是一名线下德州扑克娱乐局复盘教练，同时理解 GTO，但分析时必须以线下娱乐局实战为主，GTO 只作为补充参考。",
    "本工具服务的默认牌局画像是：线下娱乐局，通常有 ante，且 ante 数额由用户在本手牌设置项中填写，取决于当前盲注级别，不是固定 1BB；默认存在无限鱿鱼/血战鱿鱼；翻前 open 3-20BB 都属于正常现场尺度，17BB open 明确属于正常范围，不是异常大额下注。",
    "严格禁止使用常规线上 2-3BB open 的基准来评价本牌局的翻前尺度。不要写“open 异常大”“open 过大”“不符合常规尺度”这类结论，除非你已经先承认 3-20BB 在该局型中正常，再基于有效筹码、SPR、位置、对手范围和赔率证明该具体动作在实战上亏损。",
    "有 ante 和无限鱿鱼时，底池天然更大、现场 open 和 3B/4B 尺度天然更大。请使用牌局数据 JSON 中的 ante 实际数额，不要假设 ante 固定为 1BB；请把 ante 和鱿鱼作为环境参数，而不是错误来源。",
    "以上局型、open 尺度、ante、鱿鱼信息是你的内部分析基准，不要在每一局输出中反复解释“因为这是娱乐局所以 open 10BB/15BB/20BB 合理”。只有当某个尺度本身成为关键决策点时，才简短提到尺度判断。",
    "请用中文分析这手牌。不要泛泛而谈，必须结合行动线、位置、筹码、玩家风格、底池和公共牌。",
    "牌力判断必须先精确比较 5 张最佳牌，禁止只看“对手命中两对/成牌”就误判输赢。例如 Hero AK 在 A-K-8-4-5 公共牌上是 AAKK8，两对 A 和 K，明确压制 A8 的 AA88K；不要把 A8 这类较弱两对列为能赢 AK 的组合。列出 Hero 会输/会赢的组合前，必须确认其五张最佳牌确实高于/低于 Hero。",
    "如果 Hero 手牌和公共牌已经在 payload 中给出，请优先基于确切牌面做摊牌牌力比较，再讨论范围与策略。",
    "请按以下结构输出：",
    "1. 手牌摘要：一句话总结局面，不要反复说明娱乐局 open 尺度合理。",
    "2. 线下实战逐街复盘：Preflop / Flop / Turn / River 分别分析行动线是否合理、关键玩家范围、Hero 范围、对手价值范围、诈唬范围、可用尺度。",
    "3. 对手范围：按玩家位置列出主要组合类别，不需要穷举全部组合，但要具体到牌型或典型手牌；范围判断要考虑 ante、无限鱿鱼、娱乐局 3-20BB open 和宽松跟注。",
    "4. 实战建议：优先给出在线下娱乐局里更赚钱、更稳健的推荐动作、下注尺度、继续/弃牌阈值。",
    "5. GTO 参考：单独说明理论基准与当前娱乐局偏离在哪里，不要用 GTO 结论覆盖实战建议。",
    "6. Exploit 调整：结合玩家风格给出针对松凶、紧凶、紧弱、松弱、普通玩家的实战偏离。",
    "7. 最大错误与下一次复盘重点。",
    "如果信息不足，请明确指出缺失信息，并基于已有信息给出条件化判断。",
    "行动数据里 actionKind=forced_post 表示强制投入，例如 ante / SB / BB，这不是玩家主动行动；actionKind=player_decision 才是玩家主动决策。不要把盲注强制投入误读为该玩家已经主动行动。",
    "只有 missingActionsOnCurrentStreet 明确列出的玩家，才可以被判定为当前街缺少主动行动。不要凭位置顺序猜测某玩家漏行动；如果 missingActionsOnCurrentStreet 为空，就不要输出“某玩家没有行动导致牌路逻辑缺失”。",
    "注意行动数据中的 previousAction / incrementAmount / targetAmount：如果一名玩家先 open 或跟注，后面面对 3B/再加注再次行动，请理解为该玩家先前已有投入，之后补到 targetAmount，不要误判为该玩家与后位玩家同时加注到同一金额。",
    "每条行动还包含 stackBeforeAction / stackAfterAction / behindBeforeAction / behindAfterAction，请用行动当下的后手筹码评估下注尺度、SPR、是否承诺底池以及 all-in 压力。",
    "当翻前 open 是 3-20BB，尤其 17BB 左右时，请视为该局常规环境参数，而不是自动标记为过大失误；只有在结合后手、位置、对手范围、赔率后确实不合理时，才指出问题。",
    "",
    "牌局数据 JSON：",
    JSON.stringify(payload, null, 2)
  ].join("\n");
}

function handTitle(payload) {
  const board = [payload.board.flop, payload.board.turn, payload.board.river].filter(Boolean).join(" ");
  return `${payload.playerCount}人桌 ${payload.blinds} · Hero ${payload.heroCards || "未填"}${board ? ` · ${board}` : ""}`;
}

function actionLines(payload) {
  return streets.flatMap(street => (payload.actionsByStreet[street] || []).map(action => `${street} · ${action.label}`));
}

function renderPayloadSummary(payload) {
  const board = [payload.board.flop, payload.board.turn, payload.board.river].filter(Boolean).join(" ") || "未发公共牌";
  const actions = actionLines(payload);
  return `
    <div class="readonly-block">
      <h3>手牌信息</h3>
      <p>${escapeHtml(payload.playerCount)} 人桌 · ${escapeHtml(payload.blinds)} · 底池 ${escapeHtml(payload.pot)}</p>
      <p>局型：${escapeHtml(payload.gameProfile?.environment || "线下娱乐局")} · Ante ${escapeHtml(payload.ante ?? 0)} · ${payload.straddle?.unlimited ? "无限鱿鱼" : "有限鱿鱼"} · 常规 open ${escapeHtml(payload.gameProfile?.normalPreflopOpenRangeBB || "3-20BB")}</p>
      <p>Hero：${escapeHtml(payload.heroCards || "未填")} · 公共牌：${escapeHtml(board)}</p>
    </div>
    <div class="readonly-block">
      <h3>玩家</h3>
      <ul>${payload.players.filter(player => !player.empty).map(player => `
        <li>${escapeHtml(player.position || "")} ${escapeHtml(player.id)} · ${escapeHtml(player.style)} · 剩余 ${escapeHtml(player.remaining)}</li>
      `).join("")}</ul>
    </div>
    <div class="readonly-block">
      <h3>行动线</h3>
      ${actions.length ? `<ol>${actions.map(line => `<li>${escapeHtml(line)}</li>`).join("")}</ol>` : "<p>暂无行动</p>"}
    </div>
  `;
}

function favoriteRecords() {
  return readStorage(storageKeys.favorites, []);
}

function playerRecords() {
  const records = readStorage(storageKeys.players, {});
  const merged = mergePlayerRecords(records);
  if (Object.keys(merged).length !== Object.keys(records || {}).length) {
    writeStorage(storageKeys.players, merged);
  }
  return merged;
}

function playerHandCount(player) {
  if (Number.isFinite(Number(player.handCount))) return Number(player.handCount);
  return Array.isArray(player.hands) ? player.hands.length : 0;
}

function playerHandActions(payload, playerId) {
  return streets.flatMap(street => (payload.actionsByStreet[street] || [])
    .filter(action => action.playerId === playerId)
    .map(action => `${street} · ${action.label}`));
}

function playerHandSnapshot(payload, playerId) {
  const player = payload.players.find(item => item.id === playerId) || {};
  return {
    title: handTitle(payload),
    game: {
      playerCount: payload.playerCount,
      blinds: payload.blinds,
      ante: payload.ante,
      straddle: payload.straddle,
      pot: payload.pot,
      heroCards: payload.heroCards,
      board: payload.board
    },
    player: {
      id: player.id,
      position: player.position,
      style: player.style,
      stack: player.stack,
      invested: player.invested,
      remaining: player.remaining,
      folded: player.folded,
      hero: player.hero
    },
    playerActions: playerHandActions(payload, playerId),
    fullActionLine: actionLines(payload)
  };
}

function savePlayerRecord(player) {
  if (!player?.id || isSystemPlayerId(player.id)) return;
  const records = playerRecords();
  const id = normalizePlayerId(player.id);
  const key = playerRecordKey(id);
  const previous = records[key] || { id, handCount: 0, hands: [], firstSeenAt: new Date().toISOString() };
  records[key] = {
    ...previous,
    id,
    style: player.style,
    stack: player.stack,
    lastSeenAt: new Date().toISOString(),
    handCount: playerHandCount(previous),
    hands: Array.isArray(previous.hands) ? previous.hands : []
  };
  writeStorage(storageKeys.players, records);
  renderPlayerInfoList();
}

function reviewHandRecord(payload, reviewText, overrides = {}) {
  const id = overrides.id || state.lastReviewRecordId || `hand-${Date.now()}`;
  state.lastReviewRecordId = id;
  return {
    id,
    createdAt: overrides.createdAt || new Date().toISOString(),
    title: handTitle(payload),
    payload,
    reviewText,
    favorite: Boolean(overrides.favorite)
  };
}

function savePlayersFromPayload(payload, handRecord) {
  const records = playerRecords();
  payload.players.filter(player => !player.empty && player.id && !isSystemPlayerId(player.id)).forEach(player => {
    const id = normalizePlayerId(player.id);
    const key = playerRecordKey(id);
    const previous = records[key] || { id, handCount: 0, hands: [], firstSeenAt: new Date().toISOString() };
    const hands = Array.isArray(previous.hands)
      ? previous.hands.filter(hand => (hand.recordId || hand.favoriteId) !== handRecord.id)
      : [];
    hands.unshift({
      recordId: handRecord.id,
      favoriteId: handRecord.favorite ? handRecord.id : "",
      title: handRecord.title,
      createdAt: handRecord.createdAt,
      position: player.position,
      style: player.style,
      stack: player.stack,
      invested: player.invested,
      remaining: player.remaining,
      folded: player.folded,
      actions: playerHandActions(payload, player.id),
      handSummary: playerHandSnapshot(payload, player.id),
      reviewText: handRecord.reviewText
    });
    records[key] = {
      ...previous,
      id,
      style: player.style,
      stack: player.stack,
      position: player.position,
      handCount: hands.length,
      hands,
      lastSeenAt: new Date().toISOString()
    };
  });
  writeStorage(storageKeys.players, records);
  renderPlayerInfoList();
}

function saveFavoriteHand() {
  if (!state.lastReviewText || !state.lastReviewPayload) return;
  const records = favoriteRecords();
  const record = reviewHandRecord(state.lastReviewPayload, state.lastReviewText, { favorite: true });
  writeStorage(storageKeys.favorites, [record, ...records.filter(item => item.id !== record.id)]);
  savePlayersFromPayload(state.lastReviewPayload, record);
  renderFavoriteList();
  $("favoriteReview").textContent = "已收藏";
  $("favoriteReview").disabled = true;
}

function renderFavoriteList() {
  const records = favoriteRecords();
  $("favoriteList").innerHTML = records.length ? records.map(record => `
    <article class="record-card">
      <div>
        <strong>${escapeHtml(record.title)}</strong>
        <span>${formatDateTime(record.createdAt)}</span>
      </div>
      <button type="button" data-view-favorite="${record.id}">查看</button>
    </article>
  `).join("") : `<div class="empty-state">还没有收藏的手牌。复盘完成后点“收藏本手牌”。</div>`;
}

function renderPlayerInfoList() {
  const records = Object.entries(playerRecords()).sort(([, a], [, b]) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt));
  $("playerInfoList").innerHTML = records.length ? records.map(player => `
    <article class="record-card player-record">
      <div>
        <strong>${escapeHtml(player[1].id)}</strong>
        <span>${escapeHtml(player[1].style || "普通")} · 有效筹码 ${escapeHtml(player[1].stack || "-")} · 关联手牌 ${escapeHtml(playerHandCount(player[1]))}</span>
      </div>
      <button type="button" data-view-player="${escapeHtml(player[0])}">查看</button>
    </article>
  `).join("") : `<div class="empty-state">还没有保存过 ID 的玩家。</div>`;
}

function playerBaselineText(player) {
  return player.baselineText || player.analysisText || "";
}

function compactPlayerHand(hand) {
  const summary = hand.handSummary || {};
  return {
    title: hand.title || summary.title,
    createdAt: hand.createdAt,
    position: hand.position || summary.player?.position,
    style: hand.style || summary.player?.style,
    stack: hand.stack ?? summary.player?.stack,
    invested: hand.invested ?? summary.player?.invested,
    remaining: hand.remaining ?? summary.player?.remaining,
    folded: hand.folded ?? summary.player?.folded,
    game: summary.game || {},
    playerActions: hand.actions || summary.playerActions || [],
    fullActionLine: summary.fullActionLine || [],
    previousHandReviewExcerpt: String(hand.reviewText || "").slice(0, 900)
  };
}

function recentPlayerHands(player) {
  return (Array.isArray(player.hands) ? player.hands : [])
    .slice(0, playerBaselineRecentHands)
    .map(compactPlayerHand);
}

function playerAnalysisPrompt(player) {
  const handCount = playerHandCount(player);
  const baseline = playerBaselineText(player);
  const recentHands = recentPlayerHands(player);
  return [
    "你是一名德州扑克玩家画像与 exploit 策略教练。",
    "目标：为指定玩家维护一份可长期迭代的玩家基线，并给出与该玩家对战的策略建议。",
    "重要限制：为了节省 tokens，输入不会包含该玩家所有历史手牌。你只能使用“上一版玩家基线”和“最近 3 手关联手牌”更新判断。不要要求用户补发全部历史记录。",
    "牌局背景：线下娱乐局，常见 ante 和无限鱿鱼/血战鱿鱼；翻前 open 3-20BB 属于正常现场尺度。分析玩家倾向时不要套用线上常规 2-3BB open 基准。",
    "请输出中文，结构必须包含：",
    "1. 玩家基线更新：用 6-10 条短句生成可替代旧基线的新版本，包含玩家类型、翻前倾向、翻后倾向、尺度偏好、摊牌/弃牌倾向、情绪或娱乐局特征、样本置信度。",
    "2. 当前打法风格判断：在松凶/紧凶/紧弱/松弱/普通中选择，允许给混合判断和置信度。",
    "3. 对战策略建议：翻前、翻后、价值下注、诈唬、跟注/弃牌阈值分别给建议。",
    "4. 最近 3 手带来的变化：说明相比旧基线是否需要更新判断。",
    "5. 下一次重点观察：列 3 个以后记录手牌时最该观察的点。",
    "如果上一版基线为空，请把最近手牌作为初始基线；如果最近手牌不足 3 手，仍可更新，但要说明置信度较低。",
    "",
    "玩家数据 JSON：",
    JSON.stringify({
      id: player.id,
      savedStyle: player.style,
      totalRecordedHands: handCount,
      previousBaseline: baseline || "暂无旧基线，这是首次建立玩家基线。",
      previousBaselineHandCount: Number(player.baselineHandCount || 0),
      recentHandsIncluded: recentHands.length,
      recentHands
    }, null, 2)
  ].join("\n");
}

function renderPlayerDetail(player) {
  const hands = Array.isArray(player.hands) ? player.hands : [];
  const handCount = playerHandCount(player);
  const baseline = playerBaselineText(player);
  const canAnalyze = handCount >= minPlayerAnalysisHands;
  const analyzedCount = Number(player.baselineHandCount || (player.analysisText ? handCount : 0));
  const baselineStatus = baseline
    ? `已基于 ${escapeHtml(analyzedCount || handCount)} 手牌建立基线${handCount > analyzedCount ? ` · 新增 ${escapeHtml(handCount - analyzedCount)} 手待更新` : ""}`
    : "还未建立玩家基线";
  $("recordDialogMeta").textContent = `关联手牌 ${hands.length}`;
  $("recordDialogTitle").textContent = `玩家主页 · ${player.id}`;
  $("recordDialogBody").innerHTML = `
    <div class="readonly-block">
      <h3>玩家档案</h3>
      <p>当前类型：${escapeHtml(player.style || "普通")} · 有效筹码 ${escapeHtml(player.stack || "-")}</p>
      <p>最后记录：${escapeHtml(formatDateTime(player.lastSeenAt))}</p>
    </div>
    <div class="readonly-block player-strategy-card">
      <h3>游戏风格与对战策略</h3>
      <p class="baseline-meta">${baselineStatus}</p>
      ${canAnalyze ? `
        <button type="button" class="primary wide" data-analyze-player="${escapeHtml(player.id)}">${baseline ? "更新玩家基线与策略" : "建立玩家基线与策略"}</button>
        <pre id="playerAnalysisText" class="model-review">${escapeHtml(baseline || "还没有分析。点击上方按钮后，会基于最近 3 手记录建立玩家基线。")}</pre>
      ` : `
        <div class="analysis-gate" id="playerAnalysisText">需要记录大于等于 3 手，才可分析出此玩家的风格与对战策略。当前已记录 ${escapeHtml(handCount)} 手。</div>
      `}
    </div>
    <div class="readonly-block">
      <h3>关联手牌</h3>
      ${hands.length ? hands.map(hand => `
        <article class="mini-hand">
          <strong>${escapeHtml(hand.title)}</strong>
          <span>${escapeHtml(formatDateTime(hand.createdAt))} · ${escapeHtml(hand.position || "")} · 投入 ${escapeHtml(hand.invested || 0)} · ${hand.folded ? "已弃牌" : "未弃牌"}</span>
          ${hand.actions?.length ? `<ol>${hand.actions.map(action => `<li>${escapeHtml(action)}</li>`).join("")}</ol>` : "<p>暂无该玩家行动记录</p>"}
          ${hand.favoriteId ? `<button type="button" data-view-favorite="${escapeHtml(hand.favoriteId)}">查看完整手牌</button>` : "<span class=\"mini-note\">这手牌未收藏，已用于玩家画像记录。</span>"}
        </article>
      `).join("") : "<p>暂无关联手牌。完成包含此 ID 的牌谱分析后会出现在这里。</p>"}
    </div>
  `;
  showDialog($("recordDialog"));
}

function openPlayerRecord(id) {
  const player = playerRecords()[playerRecordKey(id)];
  if (!player) return;
  renderPlayerDetail(player);
}

async function analyzePlayerStyle(id) {
  const records = playerRecords();
  const key = playerRecordKey(id);
  const player = records[key];
  if (!player) return;
  const handCount = playerHandCount(player);
  if (handCount < minPlayerAnalysisHands) {
    $("playerAnalysisText").textContent = `需要记录大于等于 3 手，才可分析出此玩家的风格与对战策略。当前已记录 ${handCount} 手。`;
    return;
  }
  if (!ensureMemberForReview()) {
    $("playerAnalysisText").textContent = "当前账号还不能使用 AI 分析。";
    return;
  }
  $("playerAnalysisText").textContent = playerBaselineText(player)
    ? "正在用旧基线和最近 3 手牌更新此玩家画像..."
    : "正在基于最近手牌建立此玩家基线...";
  try {
    const data = await apiJson("/api/player-analysis", {
      method: "POST",
      body: JSON.stringify({
        messages: [
          { role: "system", content: "你是一名严谨的德州扑克玩家画像与 exploit 策略教练。你要维护可迭代玩家基线，只基于上一版基线和最近 3 手记录更新，不要求全部历史手牌。" },
          { role: "user", content: playerAnalysisPrompt(player) }
        ]
      }),
      timeoutMs: 180000
    });
    const text = data.text || "模型没有返回文本。";
    records[key] = {
      ...player,
      analysisText: text,
      baselineText: text,
      baselineHandCount: handCount,
      baselineRecentFavoriteIds: (player.hands || []).slice(0, playerBaselineRecentHands).map(hand => hand.favoriteId),
      analysisAt: new Date().toISOString()
    };
    writeStorage(storageKeys.players, records);
    $("playerAnalysisText").textContent = text;
    renderPlayerInfoList();
  } catch (error) {
    $("playerAnalysisText").textContent = error.message || "分析失败。";
  }
}

function openFavoriteRecord(id) {
  const record = favoriteRecords().find(item => item.id === id);
  if (!record) return;
  $("recordDialogMeta").textContent = formatDateTime(record.createdAt);
  $("recordDialogTitle").textContent = record.title;
  $("recordDialogBody").innerHTML = `
    ${renderPayloadSummary(record.payload)}
    <div class="readonly-block">
      <h3>复盘分析</h3>
      <pre class="model-review">${escapeHtml(record.reviewText)}</pre>
    </div>
  `;
  showDialog($("recordDialog"));
}

function setActiveTab(tab) {
  state.activeTab = tab;
  const map = {
    analysis: "analysisPage",
    favorites: "favoritesPage",
    players: "playersPage"
  };
  Object.entries(map).forEach(([key, id]) => {
    $(id).hidden = key !== tab;
    $(id).classList.toggle("active", key === tab);
  });
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.classList.toggle("active", button.dataset.tab === tab);
  });
  if (tab === "favorites") renderFavoriteList();
  if (tab === "players") renderPlayerInfoList();
  window.scrollTo(0, 0);
}

function extractResponseText(data) {
  const chatContent = data.choices?.[0]?.message?.content;
  if (chatContent) return chatContent.trim();
  if (data.output_text) return data.output_text;
  if (!Array.isArray(data.output)) return "";
  return data.output
    .flatMap(item => item.content || [])
    .map(content => content.text || "")
    .join("\n")
    .trim();
}

function renderReviewLoading() {
  $("reviewOutput").innerHTML = `
    <div class="review-loading">
      <strong>正在进行牌谱分析...</strong>
      <span>会以线下娱乐局为主，逐街分析行动线、对手范围和实战建议。</span>
    </div>
  `;
  showDialog($("reviewDialog"));
}

function renderReviewMarkdown(text) {
  $("reviewOutput").innerHTML = `
    <button type="button" id="favoriteReview" class="primary wide">收藏本手牌</button>
    <pre class="model-review">${escapeHtml(text)}</pre>
  `;
}

function renderReviewError(message) {
  $("reviewOutput").innerHTML = `
    <div class="review-loading error">
      <strong>复盘失败</strong>
      <span>${message}</span>
    </div>
  `;
  showDialog($("reviewDialog"));
}

function openReviewConfirm(message = "本手牌行动已经完成，可以现在进行牌谱分析。") {
  const copy = $("reviewConfirmDialog").querySelector(".dialog-copy");
  if (copy) copy.textContent = message;
  showDialog($("reviewConfirmDialog"));
}

async function runDeepSeekReview() {
  if (!ensureMemberForReview()) return;

  const deckError = currentDeckError();
  if (deckError) {
    renderReviewError(deckError);
    return;
  }
  renderReviewLoading();
  const payload = handPayload();
  state.lastReviewPayload = payload;
  state.lastReviewText = "";
  const data = await apiJson("/api/review", {
    method: "POST",
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: "你是一名严谨的线下德州扑克娱乐局复盘教练，必须以线下实战盈利和玩家倾向为主，逐街分析行动线、范围和可执行建议；GTO 只作为补充参考。本牌局通常有 ante，但 ante 数额取决于用户在本手牌里填写的实际设置，不是固定 1BB；本牌局默认有无限鱿鱼/血战鱿鱼，翻前 3-20BB open 都属于常见现场尺度，17BB open 明确不是异常大额下注。不得使用常规线上 2-3BB open 基准来判定本局 open 尺度异常。上述局型和尺度只作为内部分析基准，不要在输出中反复解释“娱乐局所以 open 合理”，除非尺度是关键决策点。只有数据的 missingActionsOnCurrentStreet 明确列出玩家时，才可指出当前街缺少主动行动。做摊牌和范围结论前必须准确比较五张最佳牌，不能把被 Hero 压制的弱两对误列为赢牌组合。"
        },
        {
          role: "user",
          content: reviewPrompt(payload)
        }
      ]
    }),
    timeoutMs: 180000
  });
  const text = data.text;
  state.lastReviewText = text || "模型没有返回文本。";
  renderReviewMarkdown(text || "模型没有返回文本。");
  savePlayersFromPayload(payload, reviewHandRecord(payload, state.lastReviewText));
}

function completeStreet() {
  const street = currentStreet();
  if (handEndedByFolds()) {
    $("currentAction").textContent = "只剩一名未弃牌玩家，本手牌行动已结束，可以进行牌谱分析";
    openReviewConfirm("只剩一名未弃牌玩家，本手牌可以开始牌谱分析。");
    return;
  }
  if (allInRunoutReady()) {
    if (street === "River") {
      $("currentAction").textContent = "河牌行动已完成，可以进行牌谱分析";
      openReviewConfirm("河牌行动已完成，本手牌可以开始牌谱分析。");
      return;
    }
    openDealDialog();
    return;
  }
  const missing = playersMissingAction(street);
  if (missing.length) {
    const positions = positionsForSeats();
    const names = missing.map(index => `${positions[index] || ""} ${state.seats[index].id}`.trim()).join("、");
    $("currentAction").textContent = `还有玩家未行动：${names}`;
    return;
  }
  if (street === "River") {
    $("currentAction").textContent = "河牌行动已完成，可以进行牌谱分析";
    openReviewConfirm("河牌行动已完成，本手牌可以开始牌谱分析。");
    return;
  }
  openDealDialog();
}

async function analyzeHand() {
  $("reviewOutput").innerHTML = `
    <div class="review-loading">
      <strong>开始牌谱分析</strong>
      <span>会把整手牌、每条街行动线、玩家风格和范围信息发送到你的后端分析服务。</span>
    </div>
  `;
  showDialog($("reviewDialog"));
  try {
    await runDeepSeekReview();
  } catch (error) {
    renderReviewError(error.message || "无法完成牌谱分析。请检查会员权限和服务端配置。");
  }
}

function applyPlayerEdits() {
  const index = state.selectedSeat;
  const player = state.seats[index];
  if (!player) return false;
  const oldId = player.id;
  player.stack = Number($("playerStack").value || 0);
  player.style = $("playerStyle").value;
  player.id = normalizePlayerId($("playerId").value) || oldId;
  if ($("playerDealer").checked || player.dealer) setDealer(index);
  state.actions.forEach(action => {
    if (action.seatIndex === index && action.playerId === oldId) action.playerId = player.id;
  });
  savePlayerRecord(player);
  return true;
}

function savePlayer() {
  if (!applyPlayerEdits()) return;
  closeDialog($("seatDialog"));
  render();
}

function deletePlayer() {
  const index = state.selectedSeat;
  state.seats[index] = null;
  state.playerCount = Math.min(9, Math.max(2, occupiedPlayerCount()));
  if (!state.seats.some(player => player?.dealer)) {
    const nextDealer = occupiedSeatIndexes()[0];
    if (nextDealer !== undefined) setDealer(nextDealer);
  }
  state.actions = state.actions.filter(action => action.seatIndex !== index);
  streets.forEach(street => normalizeStreetCallAmounts(street));
  refreshFoldedStates();
  state.step = Math.min(state.step, state.actions.length - 1);
  closeDialog($("seatDialog"));
  render();
}

function addPlayerToSeat() {
  const index = state.selectedSeat;
  state.seats[index] = {
    id: normalizePlayerId($("newPlayerId").value) || `P${index + 1}`,
    stack: Number($("newPlayerStack").value || defaultPlayerStack()),
    style: $("newPlayerStyle").value,
    hero: !state.seats.some(player => player?.hero),
    dealer: !state.seats.some(player => player?.dealer),
    folded: false
  };
  savePlayerRecord(state.seats[index]);
  state.playerCount = Math.min(9, Math.max(2, occupiedPlayerCount()));
  closeDialog($("seatDialog"));
  render();
}

function bind() {
  ["seatDialog", "dealDialog", "returnDialog", "reviewDialog", "recordDialog", "reviewConfirmDialog"].forEach(id => {
    $(id).addEventListener("close", () => handleDialogClosed($(id)));
  });

  $("seatLayer").addEventListener("click", event => {
    const seatButton = event.target.closest("[data-seat]");
    if (!seatButton) return;
    const seatIndex = Number(seatButton.dataset.seat);
    if (state.startConfig.active && state.startConfig.step !== "cards") {
      handleStartSeatPick(seatIndex);
      return;
    }
    if (state.startConfig.active) return;
    openSeatDialog(seatIndex);
  });

  document.querySelectorAll("[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedAction = button.dataset.action;
      state.actionTouched = true;
      updateActionAmountVisibility();
    });
  });

  $("recordAction").addEventListener("click", () => addAction(state.selectedAction));
  $("betShortcutPicks").addEventListener("click", event => {
    const button = event.target.closest("[data-pot-bet]");
    if (!button) return;
    applyPotShortcut(Number(button.dataset.potBet));
  });
  $("seatDialog").addEventListener("click", event => {
    if (event.target !== $("seatDialog")) return;
    confirmBackdropAction();
  });
  $("completeStreet").addEventListener("click", completeStreet);
  $("returnHand").addEventListener("click", openReturnDialog);
  $("returnPrevRound").addEventListener("click", returnToPreviousRound);
  $("restartHand").addEventListener("click", () => {
    closeDialog($("returnDialog"));
    resetHandToStart();
  });
  $("playerCount").addEventListener("change", () => setPlayerCount($("playerCount").value));
  $("reviewHand").addEventListener("click", analyzeHand);
  $("startHoleCards").addEventListener("click", event => {
    const button = event.target.closest("[data-start-card]");
    if (!button) return;
    state.startConfig.selectedCard = Number(button.dataset.startCard);
    renderStartOverlay();
  });
  $("startRankPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-start-rank]");
    if (!button) return;
    state.startConfig.cards[state.startConfig.selectedCard].rank = button.dataset.startRank;
    advanceStartCardSelection();
  });
  $("startSuitPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-start-suit]");
    if (!button) return;
    state.startConfig.cards[state.startConfig.selectedCard].suit = button.dataset.startSuit;
    advanceStartCardSelection();
  });
  document.querySelectorAll("[data-tab]").forEach(button => {
    button.addEventListener("click", () => setActiveTab(button.dataset.tab));
  });
  $("runReviewFromDialog").addEventListener("click", async () => {
    try {
      await runDeepSeekReview();
    } catch (error) {
      renderReviewError(error.message || "无法完成牌谱分析。请检查会员权限和服务端配置。");
    }
  });
  $("startReviewFromConfirm").addEventListener("click", async () => {
    closeDialog($("reviewConfirmDialog"));
    await analyzeHand();
  });
  $("adminLogin").addEventListener("click", adminLogin);
  $("accountLogin").addEventListener("click", accountLogin);
  ["loginUsername", "loginPassword"].forEach(id => {
    $(id).addEventListener("keydown", event => {
      if (event.key === "Enter") accountLogin();
    });
  });
  $("adminCode").addEventListener("keydown", event => {
    if (event.key === "Enter") adminLogin();
  });
  $("logoutButton").addEventListener("click", logout);
  $("refreshUsers").addEventListener("click", () => loadAdminDashboard().catch(error => {
    $("adminUserList").innerHTML = `<div class="empty-state">${escapeHtml(error.message || "刷新失败")}</div>`;
  }));
  $("saveAdminSettings").addEventListener("click", () => saveAdminSettings().catch(error => {
    $("apiKeyStatus").innerHTML = `
      <strong>保存失败</strong>
      <span>${escapeHtml(error.message || "请稍后重试")}</span>
    `;
  }));
  document.addEventListener("focusin", event => {
    if (!event.target.matches("input, select, textarea")) return;
    if (!window.matchMedia("(max-width: 720px)").matches) return;
    window.setTimeout(() => {
      event.target.scrollIntoView({ block: "center", behavior: "smooth" });
    }, 180);
  });
  $("playerStack").addEventListener("input", () => {
    const player = state.seats[state.selectedSeat];
    if (!player) return;
    player.stack = Number($("playerStack").value || 0);
    render();
  });
  $("playerDealer").addEventListener("change", () => {
    if (!$("playerDealer").checked || state.selectedSeat === null) return;
    setDealer(state.selectedSeat);
    const positions = positionsForSeats();
    $("dialogSeat").textContent = `Seat ${state.selectedSeat + 1} · ${positions[state.selectedSeat] || ""}`;
    render();
  });
  $("savePlayer").addEventListener("click", savePlayer);
  $("deletePlayer").addEventListener("click", deletePlayer);
  $("addPlayerToSeat").addEventListener("click", addPlayerToSeat);

  document.addEventListener("click", event => {
    const favoriteButton = event.target.closest("#favoriteReview");
    if (favoriteButton) {
      saveFavoriteHand();
      return;
    }
    const favoriteId = event.target.closest("[data-view-favorite]")?.dataset.viewFavorite;
    if (favoriteId) {
      openFavoriteRecord(favoriteId);
      return;
    }
    const playerId = event.target.closest("[data-view-player]")?.dataset.viewPlayer;
    if (playerId) {
      openPlayerRecord(playerId);
      return;
    }
    const analyzePlayerId = event.target.closest("[data-analyze-player]")?.dataset.analyzePlayer;
    if (analyzePlayerId) {
      analyzePlayerStyle(analyzePlayerId);
      return;
    }
    const grantOpenid = event.target.closest("[data-grant-member]")?.dataset.grantMember;
    if (grantOpenid) {
      grantMember(grantOpenid).catch(error => {
        $("adminUserList").innerHTML = `<div class="empty-state">${escapeHtml(error.message || "开通失败")}</div>`;
      });
      return;
    }
    const saveMemberOpenid = event.target.closest("[data-save-member]")?.dataset.saveMember;
    if (saveMemberOpenid) {
      updateMember(saveMemberOpenid).catch(error => {
        $("adminUserList").innerHTML = `<div class="empty-state">${escapeHtml(error.message || "保存失败")}</div>`;
      });
      return;
    }
    const deleteUserOpenid = event.target.closest("[data-delete-user]")?.dataset.deleteUser;
    if (deleteUserOpenid) {
      deleteRegisteredUser(deleteUserOpenid).catch(error => {
        $("adminUserList").innerHTML = `<div class="empty-state">${escapeHtml(error.message || "删除失败")}</div>`;
      });
      return;
    }
    const removeAction = event.target.dataset.removeAction;
    if (removeAction === undefined) return;
    const removedStreet = state.actions[Number(removeAction)]?.street;
    state.actions.splice(Number(removeAction), 1);
    if (removedStreet) normalizeStreetCallAmounts(removedStreet);
    state.step = Math.min(state.step, state.actions.length - 1);
    refreshFoldedStates();
    render();
  });

  $("blinds").addEventListener("input", () => {
    applyDefaultStacksBeforeAction();
    render();
  });
  ["heroCards", "anteAmount", "straddleAmount", "unlimitedStraddle"].forEach(id => {
    $(id).addEventListener("input", render);
  });
  $("unlimitedStraddle").addEventListener("change", render);

  $("dealCards").addEventListener("click", event => {
    const button = event.target.closest("[data-deal-card]");
    if (!button) return;
    state.selectedDealCard = Number(button.dataset.dealCard);
    renderDealCards();
  });

  $("rankPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-rank]");
    if (!button) return;
    state.dealCards[state.selectedDealCard].rank = button.dataset.rank;
    renderDealCards();
  });

  $("suitPicker").addEventListener("click", event => {
    const button = event.target.closest("[data-suit]");
    if (!button) return;
    state.dealCards[state.selectedDealCard].suit = button.dataset.suit;
    const duplicated = warnDuplicateDealCard();
    if (!duplicated && state.selectedDealCard < state.dealCards.length - 1) state.selectedDealCard += 1;
    renderDealCards();
    if (duplicated) warnDuplicateDealCard();
  });

  $("confirmDeal").addEventListener("click", confirmDeal);

}

bind();
renderFavoriteList();
renderPlayerInfoList();
render();
refreshSession().catch(error => {
  state.session = { user: null };
  renderAuthState();
  $("loginMessage").textContent = friendlyLoginError(error);
});
window.setTimeout(openStartOverlay, 0);
