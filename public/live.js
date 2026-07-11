let currentFilter = "all";
let searchTerm = "";

let allChats = [];
let hasMoreChats = false;
let chatsBootstrapped = false;
let searchActive = false;
let searchResults = [];
let searchDebounceTimer = null;
let pollIntervalId = null;

function authHeadersLive() {
  const token =
    sessionStorage.getItem("mul_nexus_token") ||
    localStorage.getItem("mul_nexus_token");

  return {
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
        ? chat.last_message.replace(/\n/g, " ").substring(0, 70) + "..."
        : "No message yet";

    wrap.innerHTML += `
      <div class="chat-card" onclick="openChat('${chat.phone}')">

        <div class="chat-top">
          <strong>${chat.name || "Unknown Student"}</strong>

          <span class="badge ${statusClass}">
            ${statusText}
          </span>
        </div>

        <div class="program">
          ${chat.program || "Program Not Selected"}
        </div>

        <div class="last-msg">
          ${preview}
        </div>

        <div style="margin-top:10px; font-size:12px; opacity:.7;">
          ${chat.phone}
        </div>

        ${
          chat.unread_count > 0
            ? `
              <div style="margin-top:8px; color:#22c55e; font-size:13px; font-weight:700;">
                ${chat.unread_count} unread
              </div>
            `
            : ""
        }

      </div>
    `;
  });

  updateLoadMoreButton();
}

function openChat(phone) {
  localStorage.setItem("selected_chat_phone", phone);
  window.location.href = "/live-chat";
}

function startLive() {
  loadChats();
  if (!pollIntervalId) {
    pollIntervalId = setInterval(loadChats, 15000);
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
