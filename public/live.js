let currentFilter = "all";
let searchTerm = "";

let allChats = [];
let hasMoreChats = false;
let chatsBootstrapped = false;
let searchActive = false;
let searchResults = [];
let searchDebounceTimer = null;
let pollIntervalId = null;

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function authHeadersLive(extra = {}) {
  const token =
    sessionStorage.getItem("mul_nexus_token") ||
    localStorage.getItem("mul_nexus_token");

  return {
    ...extra,
    Authorization: `Bearer ${token}`
  };
}

function hasStoredToken() {
  return !!(sessionStorage.getItem("mul_nexus_token") || localStorage.getItem("mul_nexus_token"));
}

function showLoginScreen() {
  if (pollIntervalId) {
    clearInterval(pollIntervalId);
    pollIntervalId = null;
  }
  document.getElementById("loginOverlay").classList.remove("hidden");
  document.getElementById("mainApp").classList.add("hidden");
}

function showMainApp() {
  document.getElementById("loginOverlay").classList.add("hidden");
  document.getElementById("mainApp").classList.remove("hidden");
}

async function loginLive() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const errorBox = document.getElementById("loginError");
  errorBox.innerText = "";

  if (!username || !password) {
    errorBox.innerText = "Please enter username and password";
    return;
  }

  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!data.success) {
      errorBox.innerText = data.error || "Login failed";
      return;
    }

    // Persisted deliberately (not sessionStorage) so an agent stays logged
    // in across app/browser restarts on their phone.
    localStorage.setItem("mul_nexus_token", data.token);

    showMainApp();
    startLive();
  } catch (error) {
    console.error("Login error:", error);
    errorBox.innerText = "Server connection failed";
  }
}

function logoutLive() {
  localStorage.removeItem("mul_nexus_token");
  sessionStorage.removeItem("mul_nexus_token");
  showLoginScreen();
}

async function loadChats() {
  if (searchActive) return;
  try {
    const res = await fetch("/api/chats", {
      headers: authHeadersLive()
    });

    if (res.status === 401) {
      showLoginScreen();
      return;
    }

    const data = await res.json();
    if (!data.success) {
      console.error(data);
      return;
    }

    const fetched = data.chats || [];
    const fetchedLive = fetched.filter(c => c.status === "agent_waiting" || c.status === "agent_active");
    const fetchedRecent = fetched.filter(c => c.status !== "agent_waiting" && c.status !== "agent_active");

    const byPhone = new Map(allChats.map(c => [c.phone, c]));

    byPhone.forEach((c, phone) => {
      if (c.status === "agent_waiting" || c.status === "agent_active") byPhone.delete(phone);
    });
    fetchedLive.forEach(c => byPhone.set(c.phone, c));
    fetchedRecent.forEach(c => byPhone.set(c.phone, c));

    allChats = Array.from(byPhone.values());

    if (!chatsBootstrapped) {
      hasMoreChats = !!data.hasMore;
      chatsBootstrapped = true;
    }

    if (searchActive) return; // a search may have started while this request was in flight

    renderChats();
  } catch (err) {
    console.error("loadChats error:", err);
  }
}

async function loadMoreChats() {
  const recentChats = allChats.filter(c => c.status !== "agent_waiting" && c.status !== "agent_active");
  if (!recentChats.length) return;

  const oldest = recentChats.reduce((min, c) => {
    const t = new Date(c.updated_at || 0).getTime();
    return t < min ? t : min;
  }, Infinity);

  const btn = document.getElementById("loadMoreChatsBtn");
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Loading...";
  }

  try {
    const res = await fetch(`/api/chats?before=${encodeURIComponent(new Date(oldest).toISOString())}`, {
      headers: authHeadersLive()
    });
    if (res.status === 401) {
      showLoginScreen();
      return;
    }
    const data = await res.json();
    if (!data.success) return;

    const byPhone = new Map(allChats.map(c => [c.phone, c]));
    (data.chats || []).forEach(c => {
      if (c.status !== "agent_waiting" && c.status !== "agent_active") {
        byPhone.set(c.phone, c);
      }
    });
    allChats = Array.from(byPhone.values());
    hasMoreChats = !!data.hasMore;

    renderChats();
  } catch (err) {
    console.error("loadMoreChats error:", err);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Load More Chats";
    }
    updateLoadMoreButton();
  }
}

async function performChatSearch(query) {
  searchActive = true;
  updateLoadMoreButton();
  try {
    const res = await fetch(`/api/chats?search=${encodeURIComponent(query)}`, {
      headers: authHeadersLive()
    });
    if (res.status === 401) {
      showLoginScreen();
      return;
    }
    const data = await res.json();
    if (!data.success) return;

    searchResults = data.chats || [];
    renderChats();
  } catch (err) {
    console.error("Chat search error:", err);
  }
}

function updateLoadMoreButton() {
  const btn = document.getElementById("loadMoreChatsBtn");
  if (!btn) return;
  const shouldShow = !searchActive && currentFilter === "all" && hasMoreChats;
  btn.classList.toggle("hidden", !shouldShow);
}

function renderChats() {
  const wrap = document.getElementById("chatList");
  wrap.innerHTML = "";

  const source = searchActive ? searchResults : allChats;

  const filteredChats = source.filter(chat => {
    if (currentFilter === "waiting") return chat.status === "agent_waiting";
    if (currentFilter === "active") return chat.status === "agent_active";
    return true;
  });

  // Merging a live update into an existing chat (loadChats) preserves that
  // chat's old array position, so without re-sorting here, a chat that just
  // got a new message wouldn't visibly move to the top until a full reload.
  filteredChats.sort((a, b) => {
    const priority = { agent_waiting: 3, agent_active: 2, active: 1, bot: 0 };
    const aP = priority[a.status] || 0;
    const bP = priority[b.status] || 0;
    if (bP !== aP) return bP - aP;

    const aUnread = Number(a.unread_count || 0);
    const bUnread = Number(b.unread_count || 0);
    if (bUnread !== aUnread) return bUnread - aUnread;

    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });

  if (!filteredChats.length) {
    wrap.innerHTML = `
      <div class="chat-card">
        <div class="last-msg">
          No chats found.
        </div>
      </div>
    `;
    updateLoadMoreButton();
    return;
  }

  filteredChats.forEach(chat => {
    const phone = String(chat.phone || "");
    const unreadCount = Number(chat.unread_count || 0);
    const statusClass =
      chat.status === "agent_waiting"
        ? "waiting"
        : "active-badge";

    const statusText =
      chat.status === "agent_waiting"
        ? "Waiting"
        : "Active";

    const preview =
      chat.last_message
        ? String(chat.last_message).replace(/\n/g, " ").substring(0, 70) + "..."
        : "No message yet";

    wrap.innerHTML += `
      <div class="chat-card" data-phone="${escapeHtml(phone)}">

        <div class="chat-top">
          <strong>${escapeHtml(chat.name || "Unknown Student")}</strong>

          <span class="badge ${statusClass}">
            ${statusText}
          </span>
        </div>

        <div class="program">
          ${escapeHtml(chat.program || "Program Not Selected")}
        </div>

        <div class="last-msg">
          ${escapeHtml(preview)}
        </div>

        <div style="margin-top:10px; font-size:12px; opacity:.7;">
          ${escapeHtml(phone)}
        </div>

        ${
          unreadCount > 0
            ? `
              <div style="margin-top:8px; color:#22c55e; font-size:13px; font-weight:700;">
                ${unreadCount} unread
              </div>
            `
            : ""
        }

      </div>
    `;
  });

  wrap.querySelectorAll(".chat-card[data-phone]").forEach(card => {
    card.addEventListener("click", () => openChat(card.dataset.phone));
  });

  updateLoadMoreButton();
}

function openChat(phone) {
  localStorage.setItem("selected_chat_phone", phone);
  window.location.href = "/live-chat";
}

function startLive() {
  loadChats();
  loadAgentAvailability();
  refreshPushBarState();
  if (!pollIntervalId) {
    pollIntervalId = setInterval(loadChats, 15000);
  }
}

async function loadAgentAvailability() {
  try {
    const res = await fetch("/api/agent-status", { headers: authHeadersLive() });
    if (res.status === 401) {
      showLoginScreen();
      return;
    }
    const data = await res.json();
    const toggle = document.getElementById("agentAvailabilityToggle");
    if (toggle) toggle.checked = !!data.status;
  } catch (error) {
    console.error("loadAgentAvailability error:", error);
  }
}

async function toggleAgentAvailability() {
  try {
    // Was: GET the current server-side status, then POST its opposite -
    // the same stale-read race fixed in admin.js's toggleAgent(). Use the
    // checkbox's own .checked (already the correct new value the instant
    // onchange fires) instead of a separate GET-then-invert round-trip.
    const toggle = document.getElementById("agentAvailabilityToggle");
    if (!toggle) return;

    const newStatus = toggle.checked;

    await fetch("/api/toggle-agent", {
      method: "POST",
      headers: authHeadersLive({ "Content-Type": "application/json" }),
      body: JSON.stringify({ status: newStatus })
    });

    loadAgentAvailability();
  } catch (error) {
    console.error("toggleAgentAvailability error:", error);
  }
}

// ---- Push Notifications ----
// Same logic as admin.js's push functions (see there for the fuller
// comments) - kept as a separate copy since live.js runs unbundled and
// standalone from admin.js, same trade-off already accepted for
// lib/programMatcher.js's duplicate in admin.js.
function urlBase64ToUint8ArrayLive(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function getPushSubscriptionStateLive() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

async function refreshPushBarState() {
  const sub = document.getElementById("pushNotifSub");
  if (!sub) return;

  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    sub.textContent = "Not supported on this browser";
    return;
  }

  const existing = await getPushSubscriptionStateLive();
  sub.textContent = existing
    ? "Enabled - tap to turn off"
    : "Get alerted for new chats even when this app is closed";
}

async function togglePushNotifications() {
  const sub = document.getElementById("pushNotifSub");
  try {
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      if (sub) sub.textContent = "Not supported on this browser";
      return;
    }

    // Permission check/request comes FIRST, before any other await - see
    // admin.js's togglePushNotifications() for why. A prior explicit
    // "denied" never re-prompts either, so tell the user where to fix it.
    if (Notification.permission === "denied") {
      if (sub) sub.textContent = "Blocked - enable Notifications for this site in browser settings";
      return;
    }

    if (Notification.permission !== "granted") {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        if (sub) sub.textContent = "Permission denied - enable it in browser settings";
        return;
      }
    }

    const existingSub = await getPushSubscriptionStateLive();

    if (existingSub) {
      await fetch("/api/push/unsubscribe", {
        method: "POST",
        headers: authHeadersLive({ "Content-Type": "application/json" }),
        body: JSON.stringify({ endpoint: existingSub.endpoint })
      });
      await existingSub.unsubscribe();
      refreshPushBarState();
      return;
    }

    const keyRes = await fetch("/api/push/vapid-public-key", { headers: authHeadersLive() });
    const keyData = await keyRes.json();
    if (!keyData.success) {
      if (sub) sub.textContent = "Not configured on the server yet";
      return;
    }

    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8ArrayLive(keyData.publicKey)
    });

    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: authHeadersLive({ "Content-Type": "application/json" }),
      body: JSON.stringify(subscription.toJSON())
    });

    refreshPushBarState();
  } catch (error) {
    console.error("togglePushNotifications error:", error);
    if (sub) sub.textContent = "Something went wrong - try again";
  }
}

if (hasStoredToken()) {
  showMainApp();
  startLive();
} else {
  showLoginScreen();
}

document
  .getElementById("waitingTab")
  .addEventListener("click", () => {
    currentFilter = "waiting";

    document
      .querySelectorAll(".tab")
      .forEach(btn => btn.classList.remove("active"));

    document
      .getElementById("waitingTab")
      .classList.add("active");

    renderChats();
  });

document
  .getElementById("activeTab")
  .addEventListener("click", () => {
    currentFilter = "active";

    document
      .querySelectorAll(".tab")
      .forEach(btn => btn.classList.remove("active"));

    document
      .getElementById("activeTab")
      .classList.add("active");

    renderChats();
  });

document
  .getElementById("allTab")
  .addEventListener("click", () => {
    currentFilter = "all";

    document
      .querySelectorAll(".tab")
      .forEach(btn => btn.classList.remove("active"));

    document
      .getElementById("allTab")
      .classList.add("active");

    renderChats();
  });

document
  .getElementById("searchInput")
  .addEventListener("input", (e) => {
    searchTerm = e.target.value.trim();

    clearTimeout(searchDebounceTimer);

    if (!searchTerm) {
      searchActive = false;
      searchResults = [];
      renderChats();
      return;
    }

    searchDebounceTimer = setTimeout(() => performChatSearch(searchTerm), 300);
  });
