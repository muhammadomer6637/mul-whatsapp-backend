const BASE = window.location.origin;

let selectedPhone = null;
let currentSection = "dashboard";
let currentRange = "24h";
let allChats = [];
let currentChatFilter = "all";
let highlightedPhone = null;
const AGENTS = [
  { username: "omer", password: "1234", name: "Omer" },
  { username: "agent2", password: "1234", name: "Agent 2" }
];
let currentAgent = "";

let lastAgentMessageMap = {};
const notificationSound = new Audio("/notification.mp3");
notificationSound.volume = 0.6;

function setCurrentAgent(agent) {
  currentAgent = agent;
  localStorage.setItem("currentAgent", agent);
  renderChatList();
}

function handleLogin() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const error = document.getElementById("loginError");

  const agent = AGENTS.find(
    a => a.username === username && a.password === password
  );

  if (!agent) {
    error.innerText = "Invalid credentials";
    return;
  }

  currentAgent = agent.name;
  localStorage.setItem("currentAgent", agent.name);

  document.getElementById("loginScreen").style.display = "none";

  loadDashboard();
  loadChats();
  loadAgentStatus();
}

function showSection(id, btn = null) {
  currentSection = id;

  document.querySelectorAll(".section").forEach(section => section.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");

  document.querySelectorAll(".nav-btn").forEach(button => button.classList.remove("active"));

  if (btn) {
    btn.classList.add("active");
  } else {
    const targetBtn = document.querySelector(`.nav-btn[data-section="${id}"]`);
    if (targetBtn) targetBtn.classList.add("active");
  }

  const title = document.getElementById("pageTitle");
  const subtitle = document.getElementById("pageSubtitle");
  const topbar = document.getElementById("topbar");

  if (id === "dashboard") {
    topbar.classList.remove("agent-mode");
    title.textContent = "Dashboard";
    subtitle.textContent = "Admissions insights, unread activity, and lead intelligence";
    loadDashboard(currentRange);
  } else {
    topbar.classList.add("agent-mode");
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

async function loadAgentStatus() {
  const res = await fetch(`${BASE}/api/agent-status`);
  const data = await res.json();

  const btn = document.getElementById("agentToggleBtn");
  if (btn) {
    btn.textContent = data.status ? "Agent ON 🟢" : "Agent OFF 🔴";
  }
}

async function toggleAgent() {
  const res = await fetch(`${BASE}/api/agent-status`);
  const data = await res.json();

  const newStatus = !data.status;

  await fetch(`${BASE}/api/toggle-agent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: newStatus })
  });

  loadAgentStatus();
}

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
      <div class="mini-stat"><h4>Agent Waiting</h4><div class="mini-value">${stats.agentWaiting}</div></div>
      <div class="mini-stat"><h4>Agent Active</h4><div class="mini-value">${stats.agentActive}</div></div>
      <div class="mini-stat"><h4>Active with Bot</h4><div class="mini-value">${stats.activeWithBot}</div></div>
      <div class="mini-stat"><h4>Total Unread</h4><div class="mini-value">${stats.totalUnreadMessages}</div></div>
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
            <div class="bar-track"><div class="bar-fill" style="width:${width}%"></div></div>
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
        <td><span class="status-chip status-${lead.status}">${formatStatus(lead.status)}</span></td>
        <td>${formatDateTime(lead.updated_at)}</td>
      </tr>
    `).join("");
  } catch (error) {
    console.error("Dashboard load error:", error);
  }
}

function setChatFilter(filter, button) {
  currentChatFilter = filter;
  document.querySelectorAll(".wa-filters .ghost-btn").forEach(btn => btn.classList.remove("active-filter"));
  button.classList.add("active-filter");
  renderChatList();
}

async function loadChats() {
  try {
    const res = await fetch(`${BASE}/api/chats`);
    const data = await res.json();
    if (!data.success) return;

    allChats = data.chats || [];
checkAgentSound(allChats);
updateAgentMiniStats(allChats);
renderChatList();
  } catch (error) {
    console.error("Chats load error:", error);
  }
}

function updateAgentMiniStats(chats) {
  const total = chats.length;
  const waiting = chats.filter(chat => chat.status === "agent_waiting").length;
  const active = chats.filter(chat => chat.status === "agent_active").length;
  const unread = chats.reduce((sum, chat) => {
    if (chat.status === "agent_waiting" || chat.status === "agent_active") {
      return sum + Number(chat.unread_count || 0);
    }
    return sum;
  }, 0);

  const totalEl = document.getElementById("agentTotalChats");
  const waitingEl = document.getElementById("agentWaitingChats");
  const activeEl = document.getElementById("agentActiveChats");
  const unreadEl = document.getElementById("agentUnreadChats");

  if (totalEl) totalEl.textContent = total;
  if (waitingEl) waitingEl.textContent = waiting;
  if (activeEl) activeEl.textContent = active;
  if (unreadEl) unreadEl.textContent = unread;
}

function filterChats() {
  renderChatList();
}

function checkAgentSound(chats) {
  chats.forEach(chat => {
    const isAgentChat =
      chat.status === "agent_waiting" || chat.status === "agent_active";

    if (!isAgentChat) return;

   const chatKey = chat.id || chat.phone;
const lastMsgKey = `${chatKey}_${chat.last_message_time || chat.updated_at || ""}`;

if (lastAgentMessageMap[chatKey] && lastAgentMessageMap[chatKey] !== lastMsgKey) {
  notificationSound.play().catch(() => {});
}

lastAgentMessageMap[chatKey] = lastMsgKey;
  });
}

function renderChatList() {
  const search = document.getElementById("chatSearch")?.value.toLowerCase().trim() || "";
 let filtered = allChats.filter(chat => {

  // login safety
  if (!currentAgent) return false;

  // unassigned chats sab ko
  if (!chat.assigned_agent) return true;

  // sirf apni chats
  return chat.assigned_agent === currentAgent;
});

  const now = Date.now();

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

  // 🔥 SORTING FIX
  filtered.sort((a, b) => {
    // 🔥 apni chats top par
if (a.assigned_agent === currentAgent && b.assigned_agent !== currentAgent) return -1;
if (a.assigned_agent !== currentAgent && b.assigned_agent === currentAgent) return 1;
    const priority = {
      agent_waiting: 3,
      agent_active: 2,
      active: 1,
      bot: 0
    };

    const aP = priority[a.status] || 0;
    const bP = priority[b.status] || 0;

    if (bP !== aP) return bP - aP;

    const aUnread = Number(a.unread_count || 0);
    const bUnread = Number(b.unread_count || 0);

    if (bUnread !== aUnread) return bUnread - aUnread;

    return new Date(b.updated_at || 0) - new Date(a.updated_at || 0);
  });

  document.getElementById("chatCountBadge").textContent = filtered.length;

  document.getElementById("chatList").innerHTML = filtered.map(chat => `
  <div class="chat-item status-${chat.status} ${selectedPhone === chat.phone ? "active-chat" : ""} ${highlightedPhone === chat.phone ? "new-message-highlight" : ""}" onclick="openChat('${chat.phone}')">
      
      <div class="chat-topline">
        <div class="chat-name">${escapeHtml(chat.name || chat.phone)}</div>
        ${
          Number(chat.unread_count || 0) > 0 &&
          (chat.status === "agent_waiting" || chat.status === "agent_active")
            ? `<span class="unread-badge">${chat.unread_count}</span>`
            : ""
        }
      </div>

<div class="chat-program">
  ${escapeHtml(prettyProgramName(chat.program || "No program selected"))}
</div>

${
  chat.assigned_agent
    ? `<div class="assigned-badge">Assigned to ${escapeHtml(chat.assigned_agent)}</div>`
    : `<div class="assigned-badge unassigned">Unassigned</div>`
} 

${
  (chat.status === "agent_waiting" || chat.status === "agent_active") &&
  chat.last_incoming_at &&
  (now - new Date(chat.last_incoming_at).getTime()) > (20 * 60 * 60 * 1000)
    ? `<div class="expiring-badge">⚠ Expiring Soon</div>`
    : ""
}

      <div class="chat-preview">
        ${escapeHtml(chat.last_message || "No messages yet")}
      </div>

    </div>
  `).join("") || `
    <div class="empty-chat-state" style="min-height:220px;">
      <div class="empty-chat-icon">📭</div>
      <h3>No conversations found</h3>
      <p>Try changing the search or filter.</p>
    </div>
  `;
}

async function openChat(phone, markRead = true, preserveScroll = false) {
  selectedPhone = phone;
  highlightedPhone = null;
  const selectedChat = allChats.find(chat => chat.phone === phone);

  const messagesBox = document.getElementById("messages");
  const oldScrollHeight = messagesBox?.scrollHeight || 0;
  const oldScrollTop = messagesBox?.scrollTop || 0;
  const oldClientHeight = messagesBox?.clientHeight || 0;
  const wasNearBottom = oldScrollHeight - oldScrollTop - oldClientHeight < 80;

  const initials = (selectedChat?.name || "M").trim().charAt(0).toUpperCase();

  document.getElementById("chatHeader").innerHTML = `
    <div class="wa-avatar">${escapeHtml(initials)}</div>
    <div style="flex:1;">
      <h3>${escapeHtml(selectedChat?.name || phone)}</h3>
      <p>${escapeHtml(prettyProgramName(selectedChat?.program || "No program selected"))} · ${escapeHtml(selectedChat?.phone || phone)}</p>
    </div>
   <span class="status-chip status-${selectedChat?.status || "active"}">${formatStatus(selectedChat?.status || "active")}</span>

<div style="display:flex; gap:8px; margin-left:10px;">
  ${
    selectedChat?.status === "agent_waiting"
      ? `<button class="ghost-btn" onclick="takeChat('${phone}')">Take Chat</button>`
      : ""
  }

  ${
    selectedChat?.status === "agent_active"
      ? `<button class="ghost-btn" onclick="closeChat('${phone}')">Close Chat</button>`
      : ""
  }

  ${
    selectedChat?.status === "agent_waiting" || selectedChat?.status === "agent_active"
      ? `<button class="ghost-btn" onclick="switchToBot()">Back to Bot</button>`
      : ""
  }
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

  document.getElementById("messages").innerHTML = data.messages.length
    ? data.messages.map(message => {
        let content = "";

        if (
  (message.type === "image" || message.mime_type?.includes("image")) 
  && message.media_url
) {
  content = `
    <img src="${message.media_url}" 
         style="max-width:200px;border-radius:10px;cursor:pointer"
         onclick="window.open('${message.media_url}','_blank')" />
  `;
} else if (
  (message.type === "document" || message.mime_type?.includes("pdf")) 
  && message.media_url
) {
  content = `
    <a href="${message.media_url}" target="_blank" 
       style="color:#56a5ff;text-decoration:underline">
       📄 ${escapeHtml(message.file_name || "Open Document")}
    </a>
  `;
} else if (
  (message.type === "video" || message.mime_type?.includes("video")) 
  && message.media_url
) {
  content = `
    <video controls style="max-width:220px;border-radius:10px">
      <source src="${message.media_url}">
    </video>
  `;
} else if (
  (message.type === "audio" || message.mime_type?.includes("audio")) 
  && message.media_url
) {
  content = `
    <audio controls>
      <source src="${message.media_url}">
    </audio>
  `;
} else {
  content = `<div>${escapeHtml(message.text || message.type || "")}</div>`;
}

        return `
          <div class="message-row ${message.sender}">
            <div class="message-bubble">
              ${content}
              <div class="message-meta">
                ${capitalize(message.sender)} · ${formatDateTime(message.created_at, true)}
              </div>
            </div>
          </div>
        `;
      }).join("")
    : `
      <div class="empty-chat-state">
        <div class="empty-chat-icon">💬</div>
        <h3>No messages found</h3>
        <p>This conversation does not contain any saved messages yet.</p>
      </div>
    `;


setTimeout(() => {
  if (preserveScroll && !wasNearBottom) {
    messagesBox.scrollTop = oldScrollTop + (messagesBox.scrollHeight - oldScrollHeight);
  } else {
    messagesBox.scrollTop = messagesBox.scrollHeight;
  }
}, 50);

await loadChats();
}

function insertQuickReply(type) {
  const input = document.getElementById("messageInput");
  if (!input) return;

  const replies = {
    fee: `You can view the complete fee structure here:
https://www.mul.edu.pk/en/fee-calculator`,

    apply: `You can apply online through the official admission portal:
https://admission.mul.edu.pk/

Please register your account, complete your profile, submit the processing fee, and upload required documents.`,

    scholarship: `Scholarship details are available here:
https://www.mul.edu.pk/en/scholarships-and-fee-concession`,

    docs: `Required documents:
• Academic Result / Transcript
• Student CNIC or B-Form
• Father/Guardian CNIC
• Domicile
• Recent Photographs

Please make sure all documents are clear and attested where required.`,

    helpline: `For admission support, please contact:
0311-1222685

You may also share your name and interested program here so our admission representative can guide you further.`
  };

  input.value = replies[type] || "";
  input.focus();
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const msg = input.value.trim();

  if (!selectedPhone) {
    alert("Please select a chat first.");
    return;
  }

  if (!msg) return;

  try {
    const res = await fetch(`${BASE}/api/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: selectedPhone, message: msg })
    });

    const data = await res.json();

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

async function takeChat(phone) {
  if (!phone) return;

  if (!currentAgent) {
    alert("Please select an agent first.");
    return;
  }

  const chat = allChats.find(c => c.phone === phone);

  // 🚫 Agar already kisi aur ko assigned hai
  if (chat.assigned_agent && chat.assigned_agent !== currentAgent) {
    alert(`This chat is already assigned to ${chat.assigned_agent}`);
    return;
  }

  // ✅ Assign chat
  await fetch(`${BASE}/api/assign-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      agent: currentAgent
    })
  });

  // ✅ Switch to agent mode
  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      mode: "agent"
    })
  });

  await loadChats();
  await openChat(phone, false);
}

async function closeChat(phone) {
  if (!phone) return;

  // release assignment
  await fetch(`${BASE}/api/assign-chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      agent: null
    })
  });

  // back to bot
  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      phone,
      mode: "bot"
    })
  });

  await loadChats();

  selectedPhone = null;
  document.getElementById("chatHeader").innerHTML = `
    <div>
      <h3>Select a chat</h3>
      <p>Choose a conversation to start replying.</p>
    </div>
  `;
  document.getElementById("messages").innerHTML = "";
}

async function switchToBot() {
  if (!selectedPhone) {
    alert("Please select a chat first.");
    return;
  }

  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: selectedPhone, mode: "bot" })
  });

  alert("Chat switched back to bot mode.");
  await loadChats();
  await openChat(selectedPhone, false);
}

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

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
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
    if (!merged[key]) merged[key] = 0;
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
      if (e.key === "Enter") sendMessage();
    });
  }

const savedAgent = localStorage.getItem("currentAgent");

if (savedAgent) {
  currentAgent = savedAgent;
  document.getElementById("loginScreen").style.display = "none";

  loadDashboard();
  loadChats();
  loadAgentStatus();
}

  // =========================
// REAL-TIME SSE LISTENER
// =========================
const eventSource = new EventSource(`${BASE}/events`);

eventSource.onmessage = function (event) {
  console.log("SSE message:", event.data);
};

eventSource.addEventListener("chat_updated", function (event) {
  const data = JSON.parse(event.data);

  console.log("Chat updated:", data);
  highlightedPhone = data.phone;

// 🔄 Chat list refresh
loadChats();

// 🔄 Sirf current open chat refresh karo, scroll preserve ke sath
if (selectedPhone && selectedPhone === data.phone) {
  openChat(selectedPhone, false, true);
}
});

setInterval(() => {
  if (currentSection === "dashboard") {
    loadDashboard(currentRange);
  } else {
    loadChats();
  }
}, 15000);

  });

window.logout = function () {
  localStorage.removeItem("currentAgent");
  currentAgent = "";

  const loginScreen = document.getElementById("loginScreen");
  if (loginScreen) {
    loginScreen.style.display = "flex";
  }

  const username = document.getElementById("loginUsername");
  const password = document.getElementById("loginPassword");
  const error = document.getElementById("loginError");

  if (username) username.value = "";
  if (password) password.value = "";
  if (error) error.innerText = "";
};

