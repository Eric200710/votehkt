// VOTEHK 蹺蹺板即時投票前端邏輯
(function () {
  "use strict";

  var cfg = window.APP_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  var els = {
    configWarning: $("config-warning"),
    configMessage: $("config-message"),
    authView: $("auth-view"),
    authForm: $("auth-form"),
    email: $("email"),
    password: $("password"),
    loginBtn: $("login-btn"),
    signUpBtn: $("sign-up-btn"),
    appView: $("app-view"),
    userEmail: $("user-email"),
    logoutBtn: $("logout-btn"),
    plank: $("seesaw-plank"),
    anglePill: $("angle-pill"),
    ratioInfo: $("ratio-info"),
    voteLeftBtn: $("vote-left-btn"),
    voteRightBtn: $("vote-right-btn"),
    leftBadge: $("left-count-badge"),
    rightBadge: $("right-count-badge"),
    cooldownBox: $("cooldown-box"),
    historyList: $("history-list"),
    historyCount: $("history-count"),
    status: $("status")
  };

  var client = null;
  var currentUser = null;
  var lastVoteTime = null;
  var cooldownTimer = null;
  var pollTimer = null;

  function say(message, kind) {
    els.status.textContent = message || "";
    els.status.dataset.kind = kind || "info";
  }

  // ---------- 設定驗證 ----------
  function cleanUrl(url) {
    return String(url || "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
  }

  function isSecretKey(key) {
    if (key.indexOf("sb_secret_") === 0) return true;
    var parts = key.split(".");
    if (parts.length !== 3) return false;
    try {
      var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.role === "service_role";
    } catch (e) {
      return false;
    }
  }

  function configProblem() {
    var url = cleanUrl(cfg.SUPABASE_URL);
    var key = String(cfg.SUPABASE_KEY || "").trim();
    if (!url || url.indexOf("貼上") === 0) return "SUPABASE_URL 尚未設定，請換成您的 Project URL。";
    if (url.indexOf("supabase.com/dashboard") !== -1) return "SUPABASE_URL 貼成後台網址了，需為 https://<project>.supabase.co。";
    if (!/^https?:\/\/[^\s]+$/.test(url)) return "SUPABASE_URL 格式不正確。";
    if (!key || key.indexOf("貼上") === 0) return "SUPABASE_KEY 尚未設定，請換成您的 publishable key。";
    if (isSecretKey(key)) return "SECRET";
    return "";
  }

  function showConfigProblem(problem) {
    els.configWarning.hidden = false;
    if (problem === "SECRET") {
      els.configWarning.classList.add("danger");
      els.configMessage.textContent =
        "🚨 config.js 裡貼的是 secret（萬能）金鑰，已停止連線以維護安全。請更換為 publishable key 並至後台將該 secret key 作廢。";
    } else {
      els.configMessage.textContent = problem;
    }
  }

  // ---------- 錯誤訊息白話化 ----------
  function explain(err) {
    if (!err) return "";
    var code = err.code || "";
    var msg = String(err.message || err);
    if (/每 5 分鐘只能投票一次/.test(msg)) return msg;
    if (msg.indexOf("Invalid login credentials") !== -1) return "帳號或密碼錯誤。新用戶請點選「第一次來：註冊」。";
    if (msg.indexOf("User already registered") !== -1) return "此 Email 已經註冊過，請直接登入。";
    if (msg.indexOf("Password should be at least") !== -1) return "密碼長度至少需 6 個字元。";
    if (msg.indexOf("Email not confirmed") !== -1) return "此帳號尚未完成 Email 驗證，可在 Supabase 後台將 Confirm email 關閉以方便測試。";
    if (/Failed to fetch|NetworkError/i.test(msg)) return "無法連線至 Supabase，請檢查網路或 config.js。";
    if (code === "PGRST205" || /relation .* does not exist/i.test(msg)) return "找不到資料庫表格或函數：請先至 Supabase SQL Editor 執行 schema.sql。";
    return "發生錯誤：" + msg;
  }

  // ---------- 蹺蹺板角度與計算邏輯 ----------
  // 需求：傾斜角度為 (30度 / 兩邊票數比)
  // 當左邊票數多時，左端下沉（逆時針/負角度）；右邊票數多時右端下沉（順時針/正角度）
  function calculateTiltAngle(left, right) {
    if (left === 0 && right === 0) {
      return 0; // 兩邊都為 0 票，水平平衡
    }
    if (left === right) {
      return 0; // 票數相等，平衡
    }

    var angle = 0;
    if (left > right) {
      // 左邊較重，左端下沉（CSS rotate 負角度）
      if (right === 0) {
        angle = -30; // 右邊為 0 票時達最大傾斜 30 度
      } else {
        var ratio = left / right;
        // 角度 = -(30度 / 比例)，並限制最大 30 度
        angle = -(30 / ratio);
      }
    } else {
      // 右邊較重，右端下沉（CSS rotate 正角度）
      if (left === 0) {
        angle = 30; // 左邊為 0 票時達最大傾斜 30 度
      } else {
        var ratio = right / left;
        // 角度 = (30度 / 比例)，並限制最大 30 度
        angle = (30 / ratio);
      }
    }

    // 保險夾在 -30 到 +30 度之間
    return Math.max(-30, Math.min(30, angle));
  }

  function updateSeesawUI(left, right) {
    els.leftBadge.textContent = left;
    els.rightBadge.textContent = right;
    els.ratioInfo.textContent = "左邊 " + left + " 票 vs 右邊 " + right + " 票";

    var angle = calculateTiltAngle(left, right);
    // 加上動畫過渡與變換角度
    els.plank.style.transform = "rotate(" + angle.toFixed(2) + "deg)";

    var angleText = Math.abs(angle).toFixed(1) + "°";
    if (angle < -0.1) {
      els.anglePill.textContent = "左傾 " + angleText;
    } else if (angle > 0.1) {
      els.anglePill.textContent = "右傾 " + angleText;
    } else {
      els.anglePill.textContent = "目前傾斜：0.0°（平衡）";
    }
  }

  // ---------- 抓取即時票數 (全體) ----------
  async function fetchSeesawStats() {
    if (!client) return;
    try {
      var res = await client.rpc("get_seesaw_stats");
      if (res.data) {
        var left = Number(res.data.left_count || 0);
        var right = Number(res.data.right_count || 0);
        updateSeesawUI(left, right);
      }
    } catch (e) {
      console.warn("無法取得蹺蹺板即時資料", e);
    }
  }

  // ---------- 投票冷卻倒數計時器 (5分鐘 = 300秒) ----------
  function startCooldownTimer() {
    if (cooldownTimer) clearInterval(cooldownTimer);

    function tick() {
      if (!currentUser) {
        els.voteLeftBtn.disabled = true;
        els.voteRightBtn.disabled = true;
        els.cooldownBox.className = "cooldown-box";
        els.cooldownBox.textContent = "請先登入後進行投票";
        return;
      }

      if (!lastVoteTime) {
        // 從未投過票，可以立即投票
        els.voteLeftBtn.disabled = false;
        els.voteRightBtn.disabled = false;
        els.cooldownBox.className = "cooldown-box ready";
        els.cooldownBox.textContent = "🟢 您現在可以進行投票！";
        return;
      }

      var now = Date.now();
      var voteMs = new Date(lastVoteTime).getTime();
      var elapsedSec = Math.floor((now - voteMs) / 1000);
      var remainSec = 300 - elapsedSec;

      if (remainSec > 0) {
        els.voteLeftBtn.disabled = true;
        els.voteRightBtn.disabled = true;
        var mins = Math.floor(remainSec / 60);
        var secs = remainSec % 60;
        var formatted = mins + " 分 " + (secs < 10 ? "0" : "") + secs + " 秒";
        els.cooldownBox.className = "cooldown-box";
        els.cooldownBox.textContent = "⏳ 投票冷卻中，距離下次可投票還剩 " + formatted;
      } else {
        els.voteLeftBtn.disabled = false;
        els.voteRightBtn.disabled = false;
        els.cooldownBox.className = "cooldown-box ready";
        els.cooldownBox.textContent = "🟢 5分鐘冷卻結束，您現在可以再次投票！";
      }
    }

    tick();
    cooldownTimer = setInterval(tick, 1000);
  }

  // ---------- 投票動作 ----------
  async function castVote(choice) {
    if (!currentUser) {
      return say("請先登入後再進行投票！", "warn");
    }

    els.voteLeftBtn.disabled = true;
    els.voteRightBtn.disabled = true;
    say("正在提交投票…");

    try {
      var res = await client.rpc("cast_vote", { p_choice: choice });
      if (res.error) {
        say(explain(res.error), "error");
        startCooldownTimer();
        return;
      }

      say("🎉 投票成功！", "ok");
      lastVoteTime = new Date().toISOString();
      updateSeesawUI(Number(res.data.left_count || 0), Number(res.data.right_count || 0));
      startCooldownTimer();
      loadUserHistory();
    } catch (err) {
      say(explain(err), "error");
      startCooldownTimer();
    }
  }

  // ---------- 讀取使用者個人投票紀錄 ----------
  async function loadUserHistory() {
    if (!currentUser) return;
    try {
      var res = await client
        .from("votes")
        .select("id, choice, created_at")
        .order("created_at", { ascending: false });

      if (res.error) return console.warn(res.error);

      var rows = res.data || [];
      els.historyCount.textContent = "（共 " + rows.length + " 次）";

      if (rows.length > 0) {
        lastVoteTime = rows[0].created_at;
        startCooldownTimer();

        var frag = document.createDocumentFragment();
        rows.forEach(function (r) {
          var li = document.createElement("li");
          var tag = document.createElement("span");
          tag.className = "vote-tag " + r.choice;
          tag.textContent = r.choice === "left" ? "🔵 左邊 (Blue)" : "🔴 右邊 (Red)";

          var timeSpan = document.createElement("span");
          timeSpan.className = "muted";
          var dt = new Date(r.created_at);
          timeSpan.textContent = dt.toLocaleString("zh-TW", { hour12: false });

          li.appendChild(tag);
          li.appendChild(timeSpan);
          frag.appendChild(li);
        });
        els.historyList.replaceChildren(frag);
      } else {
        lastVoteTime = null;
        startCooldownTimer();
        els.historyList.innerHTML = '<li class="muted">尚無投票紀錄，趕快投下第一票吧！</li>';
      }
    } catch (e) {
      console.warn("讀取歷史投票失敗", e);
    }
  }

  // ---------- 身份驗證 ----------
  async function signIn(e) {
    e.preventDefault();
    say("正在登入…");
    els.loginBtn.disabled = true;
    var res = await client.auth.signInWithPassword({
      email: els.email.value.trim(),
      password: els.password.value
    });
    els.loginBtn.disabled = false;
    if (res.error) return say(explain(res.error), "error");
    say("登入成功！", "ok");
  }

  async function signUp() {
    if (!els.authForm.reportValidity()) return;
    say("正在註冊帳號…");
    els.signUpBtn.disabled = true;
    var res = await client.auth.signUp({
      email: els.email.value.trim(),
      password: els.password.value
    });
    els.signUpBtn.disabled = false;
    if (res.error) return say(explain(res.error), "error");
    if (!res.data.session) {
      return say("帳號已建立！請檢查確認信，或請管理者在 Supabase 關閉 Confirm email 以免驗證登入。", "warn");
    }
    say("註冊成功並已自動登入！", "ok");
  }

  async function signOut() {
    say("正在登出…");
    await client.auth.signOut();
    say("已登出。", "ok");
  }

  function handleAuthStateChange(session) {
    currentUser = session ? session.user : null;
    if (currentUser) {
      els.authView.hidden = true;
      els.appView.hidden = false;
      els.userEmail.textContent = currentUser.email || "";
      loadUserHistory();
    } else {
      els.authView.hidden = false;
      els.appView.hidden = true;
      els.historyList.innerHTML = '<li class="muted">尚無投票紀錄</li>';
      els.historyCount.textContent = "";
      lastVoteTime = null;
      startCooldownTimer();
    }
  }

  // ---------- 初始化 ----------
  function init() {
    var problem = configProblem();
    if (problem) {
      showConfigProblem(problem);
      return;
    }

    if (!window.supabase || typeof window.supabase.createClient !== "function") {
      say("Supabase SDK 載入失敗，請確認網路連線。", "error");
      return;
    }

    client = window.supabase.createClient(cleanUrl(cfg.SUPABASE_URL), String(cfg.SUPABASE_KEY).trim());

    // 事件監聽
    els.authForm.addEventListener("submit", signIn);
    els.signUpBtn.addEventListener("click", signUp);
    els.logoutBtn.addEventListener("click", signOut);
    els.voteLeftBtn.addEventListener("click", function () { castVote("left"); });
    els.voteRightBtn.addEventListener("click", function () { castVote("right"); });

    // 監聽登入狀態改變
    client.auth.onAuthStateChange(function (_event, session) {
      setTimeout(function () {
        handleAuthStateChange(session);
      }, 0);
    });

    // 載入全站翹蹺板票數
    fetchSeesawStats();
    // 每 5 秒輪詢更新一次蹺蹺板票數（多人同時在線上投票時可即時看到蹺蹺板跳動）
    pollTimer = setInterval(fetchSeesawStats, 5000);
    startCooldownTimer();
  }

  init();
})();
