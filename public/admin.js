const BASE = window.location.origin;

let selectedPhone = null;
let currentSection = "dashboard";
let currentRange = "24h";
let allChats = [];
let currentChatFilter = "all";

// Navigation
function showSection(id, btn = null) {
  currentSection = id;

  document.querySelectorAll(".section").forEach(section => {
    section.classList.add("hidden");
  });

  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach(button => {
    button.classList.remove("active");
  });

  if (btn) {
    btn.classList.add("active");
  } else {
    const targetBtn = document.querySelector(`.nav-btn[data-section="${id}"]`);
    if (targetBtn) targetBtn.classList.add("active");
  }

  const title = document.getElementById("pageTitle");
  const subtitle = document.getElementById("pageSubtitle");

  if (id === "dashboard") {
    title.textContent = "Dashboard";
    subtitle.textContent = "Admissions insights, unread activity, and lead intelligence";
    loadDashboard(currentRange);
  } else {
    title.textContent = "Agent Panel";
    subtitle.textContent = "Manage live WhatsApp inquiries, unread queues, and agent replies";
    loadChats();
  }
}

function refreshCurrentSection() {
  if (currentSection === "dashboard") {
    loadDashboard(currentRange);
  } else {
    loadChats();
    if (selectedPhone) openChat(selectedPhone, false);
  }
}

function setRange(button, range) {
  currentRange = range;
  document.querySelectorAll(".range-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
  loadDashboard(range);
}

// ================= DASHBOARD =================
async function loadDashboard(range = "24h") {
  try {
    const res = await fetch(`${BASE}/api/dashboard?range=${range}`);
    const data = await res.json();

    if (!data.success) return;

    const stats = data.stats;

    document.getElementById("stats").innerHTML = `
      <div class="stat-card">
        <div class="label">Conversations Started</div>
        <div class="value">${stats.conversationsStarted}</div>
        <div class="meta">New conversations in selected range</div>
      </div>

      <div class="stat-card">
        <div class="label">Unread Conversations</div>
        <div class="value">${stats.unreadConversations}</div>
        <div class="meta">Chats currently awaiting review</div>
      </div>

      <div class="stat-card">
        <div class="label">Total Unread Messages</div>
        <div class="value">${stats.totalUnreadMessages}</div>
        <div class="meta">Pending incoming messages across chats</div>
      </div>

      <div class="stat-card">
        <div class="label">Agent Waiting</div>
        <div class="value">${stats.agentWaiting}</div>
        <div class="meta">Leads waiting for manual handling</div>
      </div>

      <div class="stat-card">
        <div class="label">Active with Agent</div>
        <div class="value">${stats.activeWithAgent}</div>
        <div class="meta">Users active in last 10 minutes</div>
      </div>
    `;

    document.getElementById("queueSnapshot").innerHTML = `
      <div class="mini-stat">
        <h4>Agent Waiting</h4>
        <div class="mini-value">${stats.agentWaiting}</div>
      </div>
      <div class="mini-stat">
        <h4>Agent Active</h4>
        <div class="mini-value">${stats.agentActive}</div>
      </div>
      <div class="mini-stat">
        <h4>Active with Bot</h4>
        <div class="mini-value">${stats.activeWithBot}</div>
      </div>
      <div class="mini-stat">
        <h4>Total Unread</h4>
        <div class="mini-value">${stats.totalUnreadMessages}</div>
      </div>
    `;

    const topProgramsWrap = document.getElementById("topProgramsList");
    if (!data.topPrograms.length) {
      topProgramsWrap.innerHTML = `<p style="color: var(--muted);">No program inquiry data available.</p>`;
    } else {
      const normalized = normalizeProgramsForDisplay(data.topPrograms);
      const maxCount = Math.max(...normalized.map(p => p.inquiries), 1);

      topProgramsWrap.innerHTML = normalized.map(program => {
        const width = (program.inquiries / maxCount) * 100;
        return `
          <div class="program-row">
            <div class="program-row-head">
              <div class="program-name">${escapeHtml(program.program)}</div>
              <div class="program-count">${program.inquiries}</div>
            </div>
            <div class="bar-track">
              <div class="bar-fill" style="width:${width}%"></div>
            </div>
          </div>
        `;
      }).join("");
    }

    const leadsBody = document.querySelector("#leadsTable tbody");
    leadsBody.innerHTML = data.recentLeads.map(lead => `
      <tr>
        <td>${escapeHtml(lead.name || "-")}</td>
        <td>${escapeHtml(prettyProgramName(lead.program || "-"))}</td>
        <td>${escapeHtml(lead.phone || "-")}</td>
        <td>
          <span class="status-chip status-${lead.status}">
            ${formatStatus(lead.status)}
          </span>
        </td>
        <td>${formatDateTime(lead.updated_at)}</td>
      </tr>
    `).join("");
  } catch (error) {
    console.error("Dashboard load error:", error);
  }
}

// ================= AGENT PANEL =================
function setChatFilter(filter, button) {
  currentChatFilter = filter;
  document.querySelectorAll(".agent-toolbar-actions .ghost-btn").forEach(btn => {
    btn.classList.remove("active-filter");
  });
  button.classList.add("active-filter");
  renderChatList();
}

async function loadChats() {
  try {
    const res = await fetch(`${BASE}/api/chats`);
    const data = await res.json();
    if (!data.success) return;

    allChats = data.chats || [];
    renderChatList();
  } catch (error) {
    console.error("Chats load error:", error);
  }
}

function filterChats() {
  renderChatList();
}

function renderChatList() {
  const search = document.getElementById("chatSearch")?.value.toLowerCase().trim() || "";

  let filtered = [...allChats];

  if (currentChatFilter !== "all") {
    filtered = filtered.filter(chat => chat.status === currentChatFilter);
  }

  if (search) {
    filtered = filtered.filter(chat =>
      (chat.name || "").toLowerCase().includes(search) ||
      (chat.phone || "").toLowerCase().includes(search) ||
      (chat.program || "").toLowerCase().includes(search)
    );
  }

  filtered.sort((a, b) => {
    const aUnread = Number(a.unread_count || 0);
    const bUnread = Number(b.unread_count || 0);
    if (bUnread !== aUnread) return bUnread - aUnread;

    const statusPriority = {
      agent_waiting: 3,
      agent_active: 2,
      active: 1
    };

    const aStatus = statusPriority[a.status] || 0;
    const bStatus = statusPriority[b.status] || 0;
    if (bStatus !== aStatus) return bStatus - aStatus;

    const aTime = new Date(a.updated_at || 0).getTime();
    const bTime = new Date(b.updated_at || 0).getTime();
    return bTime - aTime;
  });

  document.getElementById("chatCountBadge").textContent = filtered.length;

  const html = filtered.map(chat => `
    <div class="chat-item ${selectedPhone === chat.phone ? "active-chat" : ""}" onclick="openChat('${chat.phone}')">
      <div class="chat-topline">
        <div class="chat-name">${escapeHtml(chat.name || chat.phone)}</div>
        ${Number(chat.unread_count || 0) > 0 ? `<span class="unread-badge">${chat.unread_count}</span>` : ""}
      </div>
      <div class="chat-program">${escapeHtml(prettyProgramName(chat.program || "No program selected"))}</div>
      <div class="chat-preview">${escapeHtml(chat.last_message || "No messages yet")}</div>
    </div>
  `).join("");

  document.getElementById("chatList").innerHTML = html || `
    <div class="empty-chat-state" style="min-height:220px;">
      <div class="empty-chat-icon">📭</div>
      <h3>No conversations found</h3>
      <p>Try changing the search or filter.</p>
    </div>
  `;
}

async function openChat(phone, markRead = true) {
  selectedPhone = phone;

  const selectedChat = allChats.find(chat => chat.phone === phone);

  const chatHeader = document.getElementById("chatHeader");
  chatHeader.className = "chat-header";
  chatHeader.innerHTML = `
    <div>
      <h3>${escapeHtml(selectedChat?.name || phone)}</h3>
      <p>${escapeHtml(prettyProgramName(selectedChat?.program || "No program selected"))} · ${escapeHtml(selectedChat?.phone || phone)}</p>
    </div>
    <div>
      <span class="status-chip status-${selectedChat?.status || "active"}">
        ${formatStatus(selectedChat?.status || "active")}
      </span>
    </div>
  `;

  if (markRead) {
    await fetch(`${BASE}/api/mark-read`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone })
    });
  }

  const res = await fetch(`${BASE}/api/messages/${phone}`);
  const data = await res.json();

  const html = data.messages.map(message => `
    <div class="message-row ${message.sender}">
      <div class="message-bubble">
        <div>${escapeHtml(message.text || message.type || "")}</div>
        <div class="message-meta">${capitalize(message.sender)} · ${formatDateTime(message.created_at, true)}</div>
      </div>
    </div>
  `).join("");

  document.getElementById("messages").innerHTML = html || `
    <div class="empty-chat-state">
      <div class="empty-chat-icon">💬</div>
      <h3>No messages found</h3>
      <p>This conversation does not contain any saved messages yet.</p>
    </div>
  `;

  const messagesBox = document.getElementById("messages");
  messagesBox.scrollTop = messagesBox.scrollHeight;

  await loadChats();
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const msg = input.value.trim();

  if (!selectedPhone) {
    alert("Please select a chat first.");
    return;
  }

  if (!msg) {
    return;
  }

  try {
    const res = await fetch(`${BASE}/api/send`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        phone: selectedPhone,
        message: msg
      })
    });

    const data = await res.json();
    console.log("SEND RESPONSE:", data);

    if (!res.ok || !data.success) {
      alert(data.error || "Message send failed");
      return;
    }

    input.value = "";
    await loadChats();
    await openChat(selectedPhone, false);
  } catch (error) {
    console.error("Frontend send error:", error);
    alert("Message send failed. Check browser console and Railway logs.");
  }
}

async function switchToBot() {
  if (!selectedPhone) {
    alert("Please select a chat first.");
    return;
  }

  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: selectedPhone,
      mode: "bot"
    })
  });

  alert("Chat switched back to bot mode.");
  await loadChats();
  await openChat(selectedPhone, false);
}

// ================= HELPERS =================
function formatStatus(status) {
  if (!status) return "Unknown";
  if (status === "agent_waiting") return "Agent Waiting";
  if (status === "agent_active") return "Agent Active";
  if (status === "active") return "Active";
  if (status === "bot") return "Bot";
  return status.replaceAll("_", " ");
}

function capitalize(text) {
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDateTime(value, short = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return short ? date.toLocaleString() : date.toLocaleString();
}

function normalizeProgramKey(name) {
  if (!name) return "";
  const raw = String(name).trim().toLowerCase().replace(/\s+/g, " ");

  const map = {
    "bscs": "BS Computer Science",
    "bs cs": "BS Computer Science",
    "bs computer science": "BS Computer Science",
    "bsse": "BS Software Engineering",
    "bs se": "BS Software Engineering",
    "bs software engineering": "BS Software Engineering",
    "bba": "BBA",
    "dpt": "Doctor of Physiotherapy",
    "llb": "Bachelor of Laws (LLB)",
    "m.phil education": "M.Phil Education",
    "mphil education": "M.Phil Education",
    "m.phil sociology": "M.Phil Sociology",
    "mphil sociology": "M.Phil Sociology"
  };

  return map[raw] || titleCase(raw);
}

function prettyProgramName(name) {
  return normalizeProgramKey(name);
}

function normalizeProgramsForDisplay(programs) {
  const merged = {};

  programs.forEach(item => {
    const key = normalizeProgramKey(item.program);
    if (!merged[key]) {
      merged[key] = 0;
    }
    merged[key] += Number(item.inquiries || 0);
  });

  return Object.entries(merged)
    .map(([program, inquiries]) => ({ program, inquiries }))
    .sort((a, b) => b.inquiries - a.inquiries || a.program.localeCompare(b.program));
}

function titleCase(str) {
  return String(str)
    .split(" ")
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : "")
    .join(" ");
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("messageInput");
  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        sendMessage();
      }
    });
  }

  loadDashboard();
  loadChats();

  setInterval(() => {
    if (currentSection === "dashboard") {
      loadDashboard(currentRange);
    } else {
      loadChats();
      if (selectedPhone) openChat(selectedPhone, false);
    }
  }, 15000);
});
