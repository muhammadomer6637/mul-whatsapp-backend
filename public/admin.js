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

    // Queue snapshot
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

    // Top Programs
    const topProgramsWrap = document.getElementById("topProgramsList");
    if (!data.topPrograms.length) {
      topProgramsWrap.innerHTML = `<p style="color: var(--muted);">No program inquiry data available.</p>`;
    } else {
      const maxCount = Math.max(...data.topPrograms.map(p => p.inquiries), 1);

      topProgramsWrap.innerHTML = data.topPrograms.map(program => {
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

    // Recent leads
    const leadsBody = document.querySelector("#leadsTable tbody");
    leadsBody.innerHTML = data.recentLeads.map(lead => `
      <tr>
        <td>${escapeHtml(lead.name || "-")}</td>
        <td>${escapeHtml(lead.program || "-")}</td>
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

  document.getElementById("chatCountBadge").textContent = filtered.length;

  const html = filtered.map(chat => `
    <div class="chat-item ${selectedPhone === chat.phone ? "active-chat" : ""}" onclick="openChat('${chat.phone}')">
      <div class="chat-topline">
        <div class="chat-name">${escapeHtml(chat.name || chat.phone)}</div>
        ${chat.unread_count > 0 ? `<span class="unread-badge">${chat.unread_count}</span>` : ""}
      </div>
      <div class="chat-program">${escapeHtml(chat.program || "No program selected")}</div>
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
      <p>${escapeHtml(selectedChat?.program || "No program selected")} · ${escapeHtml(selectedChat?.phone || phone)}</p>
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

  if (!msg) return;

  await fetch(`${BASE}/api/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: selectedPhone,
      message: msg
    })
  });

  input.value = "";
  await openChat(selectedPhone, false);
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

  if (short) {
    return date.toLocaleString();
  }

  return date.toLocaleString();
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

// Enter to send
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

  // Soft auto-refresh
  setInterval(() => {
    if (currentSection === "dashboard") {
      loadDashboard(currentRange);
    } else {
      loadChats();
      if (selectedPhone) openChat(selectedPhone, false);
    }
  }, 15000);
});
