// deploy refresh 2026-05-30

const BASE = window.location.origin;
// =========================
// AUTH
// =========================

let authToken =
  sessionStorage.getItem("mul_nexus_token") ||
  localStorage.getItem("mul_nexus_token");
let currentAgent = null;

function authHeaders(extraHeaders = {}) {
  return {
    ...extraHeaders,
    Authorization: `Bearer ${authToken}`
  };
}

async function loginAgent() {
  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value.trim();
  const errorBox = document.getElementById("loginError");

  errorBox.innerText = "";

  if (!username || !password) {
    errorBox.innerText = "Please enter username and password";
    return;
  }

  try {
    const response = await fetch(`${BASE}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ username, password })
    });

    const data = await response.json();

    if (!data.success) {
      errorBox.innerText = data.error || "Login failed";
      return;
    }

    authToken = data.token;
    currentAgent = data.agent;

    sessionStorage.setItem("mul_nexus_token", authToken);
localStorage.removeItem("mul_nexus_token");

    document.getElementById("loginOverlay").style.display = "none";

    checkAuth();

  } catch (error) {
    console.error("Login error:", error);
    errorBox.innerText = "Server connection failed";
  }
}

async function checkAuth() {
  if (!authToken) {
    document.getElementById("loginOverlay").style.display = "flex";
    return;
  }

  try {
    const response = await fetch(`${BASE}/api/me`, {
      headers: authHeaders()
    });

    const data = await response.json();

if (!data.success) {
  localStorage.removeItem("mul_nexus_token");
  sessionStorage.removeItem("mul_nexus_token");

  authToken = null;

  document.getElementById("loginOverlay").style.display = "flex";

  return;
}

   currentAgent = data.agent;
document.getElementById("loginOverlay").style.display = "none";

applyRolePermissions();

if (currentAgent.role === "call_agent") {
  showSection("callbacks");
}
else if (
  currentAgent.role === "admin" ||
  currentAgent.can_view_dashboard
) {
  loadDashboard();
}
else {
  showSection("agent");
}

if (
  currentAgent.role === "admin" ||
  currentAgent.role === "chat_agent"
) {
  loadChats();
}

if (currentAgent.role === "admin") {
  loadAgentStatus();
}

  } catch (error) {
    console.error("Auth check error:", error);
    document.getElementById("loginOverlay").style.display = "flex";
  }
}

function applyRolePermissions() {
  if (!currentAgent) return;

  const dashboardBtn = document.querySelector('.nav-btn[data-section="dashboard"]');
  const agentPanelBtn = document.querySelector('.nav-btn[data-section="agent"]');
  const agentManagementBtn = document.querySelector('.nav-btn[data-section="agents"]');
  const callbackBtn = document.querySelector('.nav-btn[data-section="callbacks"]');
  const agentStatusWrap = document.querySelector(".agent-status-wrap");

  if (dashboardBtn) dashboardBtn.style.display = "none";
  if (agentPanelBtn) agentPanelBtn.style.display = "none";
  if (agentManagementBtn) agentManagementBtn.style.display = "none";
  if (callbackBtn) callbackBtn.style.display = "none";
  if (agentStatusWrap) agentStatusWrap.style.display = "none";

  if (currentAgent.role === "admin") {
    if (dashboardBtn) dashboardBtn.style.display = "flex";
    if (agentPanelBtn) agentPanelBtn.style.display = "flex";
    if (agentManagementBtn) agentManagementBtn.style.display = "flex";
    if (callbackBtn) callbackBtn.style.display = "flex";
    if (agentStatusWrap) agentStatusWrap.style.display = "flex";
    return;
  }

  if (currentAgent.role === "chat_agent") {
    if (agentPanelBtn) agentPanelBtn.style.display = "flex";
    return;
  }

  if (currentAgent.role === "call_agent") {
    if (callbackBtn) callbackBtn.style.display = "flex";
    return;
  }
}

let selectedPhone = null;
let currentSection = "dashboard";
let currentRange = "24h";
let allChats = [];
let currentChatFilter = "all";
let currentCallbackFilter = "all";
let highlightedPhone = null;


let lastAgentMessageMap = {};
const notificationSound = new Audio("/notification.mp3");
notificationSound.volume = 0.6;

function toggleSidebar() {
  document.getElementById("sidebar")?.classList.toggle("sidebar-open");
  document.getElementById("sidebarOverlay")?.classList.toggle("sidebar-open");
}

function closeSidebar() {
  document.getElementById("sidebar")?.classList.remove("sidebar-open");
  document.getElementById("sidebarOverlay")?.classList.remove("sidebar-open");
}

function showSection(id, btn = null) {
  currentSection = id;
  closeSidebar();

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
} else if (id === "agent") {
  topbar.classList.add("agent-mode");
  title.textContent = "Agent Panel";
  subtitle.textContent = "Live WhatsApp conversations and admissions support";
  loadChats();
  if (!quickReplies.length) loadQuickReplies();
} else if (id === "agents") {
  topbar.classList.remove("agent-mode");
  title.textContent = "Agent Management";
  subtitle.textContent = "Create, manage, and control support team access";
  loadAgents();
}

else if (id === "callbacks") {
  topbar.classList.remove("agent-mode");

  title.textContent = "Callback Center";

  subtitle.textContent =
    "Manage callback requests and follow-up activity";

  loadCallbacks();
} else if (id === "settings") {
  topbar.classList.remove("agent-mode");

  title.textContent = "Settings";
  subtitle.textContent = "Quick replies and system configuration";

  loadQuickReplies();
}
}

function refreshCurrentSection() {
  if (currentSection === "dashboard") {
    loadDashboard(currentRange);

  } else if (currentSection === "agent") {
    loadChats();

    if (selectedPhone) {
      openChat(selectedPhone, false);
    }

  } else if (currentSection === "agents") {
    loadAgents();

  } else if (currentSection === "callbacks") {
    loadCallbacks();
  }
}

function setRange(button, range) {
  currentRange = range;
  document.querySelectorAll(".range-btn").forEach(btn => btn.classList.remove("active"));
  button.classList.add("active");
  loadDashboard(range);
}

async function loadAgentStatus() {
  const res = await fetch(`${BASE}/api/agent-status`, {
  headers: authHeaders()
});
  const data = await res.json();

const toggle = document.getElementById("agentToggleSwitch");
if (toggle) {
  toggle.checked = !!data.status;
}
}

async function toggleAgent() {
  const res = await fetch(`${BASE}/api/agent-status`, {
  headers: authHeaders()
});
  const data = await res.json();

  const newStatus = !data.status;

  await fetch(`${BASE}/api/toggle-agent`, {
    method: "POST",
   headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ status: newStatus })
  });

  loadAgentStatus();
}

function prettyInteractionCategory(category) {
  const labels = {
    programs: "Programs",
    fee_structure: "Fee Structure",
    scholarships: "Scholarships",
    admission_process: "Admission Process",
    why_choose_mul: "Why Choose MUL",
    other_support: "Other Support",
    admissions_related: "Admissions Related",
    other: "Other"
  };

  return labels[category] || category;
}

function renderInteractionStats(rows, type = "bot") {
  if (!rows || rows.length === 0) {
    return `
      <div class="stat-card performance insight-stat-card">
        <div class="label">No Data</div>
        <div class="value">0</div>
        <div class="meta">No activity found</div>
      </div>
    `;
  }

  const total = rows.reduce((sum, row) => sum + Number(row.count || 0), 0);
  const cardTypeClass = type === "agent" ? "live" : "performance";

  return rows.map(row => {
    const count = Number(row.count || 0);
    const percent = total > 0 ? Math.round((count / total) * 100) : 0;

    return `
      <div class="stat-card ${cardTypeClass} insight-stat-card">
        <div class="label">${prettyInteractionCategory(row.category)}</div>
        <div class="value">${count}</div>
        <div class="meta">${percent}% of selected period</div>
      </div>
    `;
  }).join("");
}

function showLoadingState(containerId, colspan = null) {
  const el = document.getElementById(containerId);
  if (!el || el.dataset.loadedOnce) return;
  const spinner = `<div class="loading-spinner"><span></span><span></span><span></span></div>`;
  el.innerHTML = colspan
    ? `<tr><td colspan="${colspan}">${spinner}</td></tr>`
    : spinner;
}

function markLoaded(containerId) {
  const el = document.getElementById(containerId);
  if (el) el.dataset.loadedOnce = "1";
}

async function loadDashboard(range = "24h") {
  showLoadingState("stats");
  try {
  const res = await fetch(`${BASE}/api/dashboard?range=${range}&_=${Date.now()}`, {
  headers: authHeaders()
});
    const data = await res.json();
    if (!data.success) return;

    const stats = data.stats;
    const callback = data.callbackStats || {};
    const funnel = data.funnelStats || {};
    const responseStats = data.responseStats || {};
    const botInterestStats = data.botInterestStats || [];
    const agentCategoryStats = data.agentCategoryStats || [];
    
document.getElementById("stats").innerHTML = `
  <div class="stat-card performance">
    <div class="label">Total Conversations</div>
    <div class="value">${stats.conversationsStarted}</div>
    <div class="meta">Date filtered</div>
  </div>

  <div class="stat-card performance">
    <div class="label">Total Incoming Messages</div>
    <div class="value">${stats.totalIncomingMessages}</div>
    <div class="meta">Date filtered user messages</div>
  </div>

  <div class="stat-card performance">
  <div class="label">Agent Chat Requests</div>
  <div class="value">${stats.agentChatRequests || 0}</div>
  <div class="meta">Date filtered users requested agent</div>
</div>

<div class="stat-card performance">
  <div class="label">Agent Messages Sent</div>
  <div class="value">${stats.agentMessagesSent || 0}</div>
  <div class="meta">Date filtered agent replies</div>
</div>

  <div class="stat-card live">
    <div class="label">Active with Agent</div>
    <div class="value">${stats.activeWithAgent}</div>
    <div class="meta">Live now</div>
  </div>

  <div class="stat-card live">
    <div class="label">Agent Waiting</div>
    <div class="value">${stats.agentWaiting}</div>
    <div class="meta">Live now</div>
  </div>

  <div class="stat-card live">
    <div class="label">Active with Bot</div>
    <div class="value">${stats.activeWithBot}</div>
    <div class="meta">Live now</div>
  </div>
`;
        markLoaded("stats");

        renderWeeklyOverviewCharts(data.weeklyConversations || [], stats);

        document.getElementById("callbackStats").innerHTML = `
      <div class="stat-card">
        <div class="label">Callback Requests</div>
        <div class="value">${callback.totalRequests || 0}</div>
        <div class="meta">Total callback requests received</div>
      </div>

      <div class="stat-card">
        <div class="label">Unique Callbacks</div>
        <div class="value">${callback.uniqueNumbers || 0}</div>
        <div class="meta">Unique student phone numbers</div>
      </div>

      <div class="stat-card">
        <div class="label">Repeat Requests</div>
        <div class="value">${callback.repeatRequests || 0}</div>
        <div class="meta">Students requesting callback again</div>
      </div>

      <div class="stat-card">
        <div class="label">Pending Calls</div>
        <div class="value">${callback.pending || 0}</div>
        <div class="meta">Awaiting representative action</div>
      </div>

      <div class="stat-card">
        <div class="label">Called</div>
        <div class="value">${callback.called || 0}</div>
        <div class="meta">Successfully contacted</div>
      </div>

      <div class="stat-card">
        <div class="label">Not Responded</div>
        <div class="value">${callback.notResponded || 0}</div>
        <div class="meta">No response from student</div>
      </div>

      <div class="stat-card">
        <div class="label">Follow-Up Required</div>
        <div class="value">${callback.followupRequired || 0}</div>
        <div class="meta">Need another call attempt</div>
      </div>

      <div class="stat-card">
        <div class="label">Converted</div>
        <div class="value">${callback.converted || 0}</div>
        <div class="meta">Successfully converted leads</div>
      </div>
    `;

    document.getElementById("responsePerformanceStats").innerHTML = `
  <div class="stat-card performance">
    <div class="label">Avg Chat Response Time</div>
    <div class="value">${formatDuration(responseStats.averageChatResponseSeconds || 0)}</div>
    <div class="meta">Average first response by chat agents</div>
  </div>

  <div class="stat-card performance">
    <div class="label">Callback Avg Response Time</div>
    <div class="value">${formatDuration(responseStats.averageCallbackResponseSeconds || 0)}</div>
    <div class="meta">Average first action by call agents</div>
  </div>
`;

    document.getElementById("queueSnapshot").innerHTML = `
      <div class="mini-stat"><h4>Agent Waiting</h4><div class="mini-value">${stats.agentWaiting}</div></div>
      <div class="mini-stat"><h4>Agent Active</h4><div class="mini-value">${stats.agentActive}</div></div>
      <div class="mini-stat"><h4>Active with Bot</h4><div class="mini-value">${stats.activeWithBot}</div></div>
     <div class="mini-stat"><h4>Total Incoming</h4><div class="mini-value">${stats.totalIncomingMessages}</div></div>
    `;

   document.getElementById("botInterestStats").innerHTML =
  renderInteractionStats(botInterestStats, "bot");

document.getElementById("agentCategoryStats").innerHTML =
  renderInteractionStats(agentCategoryStats, "agent");
    
    const funnelRegistrations = Number(funnel.registrations || 0);
const funnelProcessingFee = Number(funnel.processingFee || 0);
const funnelDocuments = Number(funnel.documentsSubmitted || 0);
const funnelFeePaid = Number(funnel.feePaid || 0);

document.getElementById("funnelRegistrations").textContent = funnelRegistrations;
document.getElementById("funnelProcessingFee").textContent = funnelProcessingFee;
document.getElementById("funnelDocuments").textContent = funnelDocuments;
document.getElementById("funnelFeePaid").textContent = funnelFeePaid;

const processingWidth = funnelRegistrations > 0
  ? Math.round((funnelProcessingFee / funnelRegistrations) * 100)
  : 0;

const documentsWidth = funnelRegistrations > 0
  ? Math.round((funnelDocuments / funnelRegistrations) * 100)
  : 0;

const feePaidWidth = funnelRegistrations > 0
  ? Math.round((funnelFeePaid / funnelRegistrations) * 100)
  : 0;

document.querySelector(".fill-1").style.width = funnelRegistrations > 0 ? "100%" : "0%";
document.querySelector(".fill-2").style.width = `${Math.min(processingWidth, 100)}%`;
document.querySelector(".fill-3").style.width = `${Math.min(documentsWidth, 100)}%`;
document.querySelector(".fill-4").style.width = `${Math.min(feePaidWidth, 100)}%`;

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

let weeklyConversationsChartInstance = null;
let botAgentDonutChartInstance = null;

function renderWeeklyOverviewCharts(weeklyConversations, stats) {
  if (typeof Chart === "undefined") return;

  const lineCanvas = document.getElementById("weeklyConversationsChart");
  const donutCanvas = document.getElementById("botAgentDonutChart");
  if (!lineCanvas || !donutCanvas) return;

  if (weeklyConversationsChartInstance) weeklyConversationsChartInstance.destroy();
  if (botAgentDonutChartInstance) botAgentDonutChartInstance.destroy();

  weeklyConversationsChartInstance = new Chart(lineCanvas, {
    type: "line",
    data: {
      labels: weeklyConversations.map(row => row.label),
      datasets: [{
        data: weeklyConversations.map(row => row.count),
        borderColor: "#56a5ff",
        backgroundColor: "rgba(86,165,255,0.15)",
        fill: true,
        tension: 0.35,
        pointBackgroundColor: "#56a5ff",
        pointRadius: 3
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#a8bbdc" }, grid: { color: "rgba(255,255,255,0.06)" } },
        y: { ticks: { color: "#a8bbdc" }, grid: { color: "rgba(255,255,255,0.06)" }, beginAtZero: true }
      }
    }
  });

  const agentRequested = Number(stats.agentChatRequests || 0);
  const botOnly = Math.max(Number(stats.conversationsStarted || 0) - agentRequested, 0);

  botAgentDonutChartInstance = new Chart(donutCanvas, {
    type: "doughnut",
    data: {
      labels: ["Bot only", "Agent requested"],
      datasets: [{
        data: [botOnly, agentRequested],
        backgroundColor: ["#56a5ff", "#1d9e75"],
        borderWidth: 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } }
    }
  });
}

function setChatFilter(filter, button) {
  currentChatFilter = filter;
  document.querySelectorAll(".wa-filters .ghost-btn").forEach(btn => btn.classList.remove("active-filter"));
  button.classList.add("active-filter");
  renderChatList();
}

async function loadChats() {
  showLoadingState("chatList");
  try {
   const res = await fetch(`${BASE}/api/chats`, {
  headers: authHeaders()
});
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
  let filtered = [...allChats];

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

  const listEl = document.getElementById("chatList");

  if (!filtered.length) {
    listEl.innerHTML = `
      <div class="empty-chat-state" style="min-height:220px;">
        <div class="empty-chat-icon">📭</div>
        <h3>No conversations found</h3>
        <p>Try changing the search or filter.</p>
      </div>
    `;
    markLoaded("chatList");
    return;
  }

  const existingEls = new Map();
  listEl.querySelectorAll(".chat-item[data-phone]").forEach(el => {
    existingEls.set(el.dataset.phone, el);
  });

  filtered.forEach((chat, index) => {
    const rowHtml = buildChatRowHtml(chat, now);
    const className = `chat-item status-${chat.status} ${selectedPhone === chat.phone ? "active-chat" : ""} ${highlightedPhone === chat.phone ? "new-message-highlight" : ""}`;

    let el = existingEls.get(chat.phone);

    if (el) {
      existingEls.delete(chat.phone);
      if (el.className !== className) el.className = className;
      if (el.dataset.snapshot !== rowHtml) {
        el.innerHTML = rowHtml;
        el.dataset.snapshot = rowHtml;
      }
    } else {
      el = document.createElement("div");
      el.dataset.phone = chat.phone;
      el.className = className;
      el.onclick = () => openChat(chat.phone);
      el.innerHTML = rowHtml;
      el.dataset.snapshot = rowHtml;
    }

    const elAtIndex = listEl.children[index];
    if (elAtIndex !== el) {
      listEl.insertBefore(el, elAtIndex || null);
    }
  });

  existingEls.forEach(el => el.remove());

  markLoaded("chatList");
}

function buildChatRowHtml(chat, now) {
  return `
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
  <div style="display:flex; align-items:center; gap:8px;">
  <span class="status-chip status-${selectedChat?.status || "active"}">
    ${formatStatus(selectedChat?.status || "active")}
  </span>

  <button
    class="ghost-btn"
    onclick="toggleFunnelMenu()"
    style="padding:6px 10px;"
  >
    ⋮
  </button>
</div>

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
     headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ phone })
    });
  }

 const res = await fetch(`${BASE}/api/messages/${phone}`, {
  headers: authHeaders()
});
  const data = await res.json();

  let lastDateLabel = null;
  document.getElementById("messages").innerHTML = data.messages.length
    ? data.messages.map((message, index) => {
        let content = "";

        if (
  (message.type === "image" || message.mime_type?.includes("image")) 
  && message.media_url
) {
  content = `
    <img src="${escapeHtml(message.media_url)}"
         style="max-width:200px;border-radius:10px;cursor:pointer"
         onclick="window.open('${escapeHtml(message.media_url)}','_blank')" />
  `;
} else if (
  (message.type === "document" || message.mime_type?.includes("pdf"))
  && message.media_url
) {
  content = `
    <a href="${escapeHtml(message.media_url)}" target="_blank"
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
      <source src="${escapeHtml(message.media_url)}">
    </video>
  `;
} else if (
  (message.type === "audio" || message.mime_type?.includes("audio"))
  && message.media_url
) {
  content = `
    <audio controls>
      <source src="${escapeHtml(message.media_url)}">
    </audio>
  `;
} else {
  content = `<div>${escapeHtml(message.text || message.type || "")}</div>`;
}

        const dateLabel = formatDayLabel(message.created_at);
        let divider = "";
        if (dateLabel !== lastDateLabel) {
          divider = `<div class="date-divider"><span>${dateLabel}</span></div>`;
          lastDateLabel = dateLabel;
        }

        const isOutgoing = message.sender === "agent" || message.sender === "bot";
        const sentTick = isOutgoing ? ` <span class="sent-tick">✓</span>` : "";
        const isLatest = index === data.messages.length - 1;

        return `
          ${divider}
          <div class="message-row ${message.sender}${isLatest ? " message-in" : ""}">
            <div class="message-bubble">
              ${content}
              <div class="message-meta">
                ${capitalize(message.sender)} · ${formatDateTime(message.created_at, true)}${sentTick}
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

programs: `You can explore programs offered at Minhaj University Lahore through the official website:

https://www.mul.edu.pk/en/admissions-open

Please let us know your preferred program or study level so we can guide you accordingly.`,
    
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

async function toggleFunnelMenu() {
  const existing = document.getElementById("funnelMenu");

  if (existing) {
    existing.remove();
    return;
  }

  const header = document.getElementById("chatHeader");
  if (!header) return;

  const menu = document.createElement("div");
  menu.id = "funnelMenu";

  let funnel = {};

try {
  const res = await fetch(`${BASE}/api/funnel-status/${selectedPhone}`, {
    headers: authHeaders()
  });

  const data = await res.json();

  if (data.success) {
    funnel = data.funnel || {};
  }
} catch (error) {
  console.error("load funnel status error:", error);
}

const registeredIcon = funnel.registered_at ? "✓" : "○";
const processingIcon = funnel.processing_fee_paid_at ? "✓" : "○";
const documentsIcon = funnel.documents_submitted_at ? "✓" : "○";
const admissionFeeIcon = funnel.admission_fee_paid_at ? "✓" : "○";

  menu.innerHTML = `
  <div class="funnel-menu-card">
  
    <button
  class="funnel-menu-item"
  ${funnel.registered_at ? "disabled" : `onclick="updateFunnelStage('registered')"`}
>
  ${registeredIcon} Registered
</button>

<button
  class="funnel-menu-item"
  ${funnel.processing_fee_paid_at ? "disabled" : `onclick="updateFunnelStage('processing_fee_paid')"`}
>
  ${processingIcon} Processing Fee Paid
</button>

<button
  class="funnel-menu-item"
  ${funnel.documents_submitted_at ? "disabled" : `onclick="updateFunnelStage('documents_submitted')"`}
>
  ${documentsIcon} Documents Submitted
</button>

<button
  class="funnel-menu-item"
  ${funnel.admission_fee_paid_at ? "disabled" : `onclick="updateFunnelStage('admission_fee_paid')"`}
>
  ${admissionFeeIcon} Admission Fee Paid
</button>

      <hr>

      <button class="funnel-menu-item" onclick="assignToCallAgent()">
        Assign To Call Agent
      </button>
    </div>
  `;

  menu.style.position = "absolute";
  menu.style.right = "20px";
  menu.style.top = "70px";
  menu.style.zIndex = "999";

  header.appendChild(menu);
}

async function updateFunnelStage(stage) {
  if (!selectedPhone) {
    notify("Please select a chat first.", "warning");
    return;
  }

  try {
    const res = await fetch(`${BASE}/api/funnel-status`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        phone: selectedPhone,
        stage
      })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to update funnel status", "error");
      return;
    }

    const menu = document.getElementById("funnelMenu");
    if (menu) menu.remove();

   await openChat(selectedPhone, false);

  } catch (error) {
    console.error("updateFunnelStage error:", error);
    notify("Funnel status update failed.", "error");
  }
}

async function assignToCallAgent() {
  if (!selectedPhone) {
    notify("Please select a chat first.", "warning");
    return;
  }

  const confirmed = await customConfirm(
    "Assign this chat to the call agent team? The student will be moved back to the bot menu."
  );
  if (!confirmed) return;

  try {
    const res = await fetch(`${BASE}/api/assign-call-agent`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ phone: selectedPhone })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to assign to call agent", "error");
      return;
    }

    const menu = document.getElementById("funnelMenu");
    if (menu) menu.remove();

    notify("Assigned to call agent team", "success");
    await loadChats();
    await openChat(selectedPhone, false);

  } catch (error) {
    console.error("assignToCallAgent error:", error);
    notify("Failed to assign to call agent", "error");
  }
}

let quickReplyMatches = [];
let quickReplyActiveIndex = 0;

function setupMessageInputShortcuts() {
  const input = document.getElementById("messageInput");
  if (!input) return;

  input.addEventListener("keydown", function (event) {
    const dropdown = document.getElementById("quickReplyDropdown");
    const dropdownOpen = dropdown && !dropdown.classList.contains("hidden");

    if (dropdownOpen && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
      event.preventDefault();
      const delta = event.key === "ArrowDown" ? 1 : -1;
      quickReplyActiveIndex =
        (quickReplyActiveIndex + delta + quickReplyMatches.length) % quickReplyMatches.length;
      renderQuickReplyDropdown();
      return;
    }

    if (dropdownOpen && event.key === "Escape") {
      hideQuickReplyDropdown();
      return;
    }

    if (event.key !== "Enter") return;

    if (dropdownOpen && quickReplyMatches.length) {
      event.preventDefault();
      event.stopImmediatePropagation();
      selectQuickReply(quickReplyMatches[quickReplyActiveIndex]);
      return;
    }

    if (event.shiftKey) {
      event.stopImmediatePropagation();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();
    sendMessage();
  }, true);

  input.addEventListener("input", function () {
    const value = input.value;

    if (!value.startsWith("/") || value.includes(" ")) {
      hideQuickReplyDropdown();
      return;
    }

    const filterText = value.slice(1).toLowerCase();

    quickReplyMatches = quickReplies.filter(qr =>
      qr.shortcut.toLowerCase().startsWith(filterText)
    );

    if (!quickReplyMatches.length) {
      hideQuickReplyDropdown();
      return;
    }

    quickReplyActiveIndex = 0;
    renderQuickReplyDropdown();
  });
}

function renderQuickReplyDropdown() {
  const dropdown = document.getElementById("quickReplyDropdown");
  if (!dropdown) return;

  dropdown.innerHTML = quickReplyMatches.map((qr, index) => `
    <div class="quick-reply-option${index === quickReplyActiveIndex ? " active-option" : ""}" data-index="${index}">
      <div class="qr-shortcut">/${escapeHtml(qr.shortcut)}</div>
      <div class="qr-preview">${escapeHtml(qr.message)}</div>
    </div>
  `).join("");

  dropdown.classList.remove("hidden");

  dropdown.querySelectorAll(".quick-reply-option").forEach(el => {
    el.onclick = () => selectQuickReply(quickReplyMatches[Number(el.dataset.index)]);
  });
}

function hideQuickReplyDropdown() {
  const dropdown = document.getElementById("quickReplyDropdown");
  if (!dropdown) return;
  dropdown.classList.add("hidden");
  dropdown.innerHTML = "";
  quickReplyMatches = [];
}

function selectQuickReply(qr) {
  const input = document.getElementById("messageInput");
  if (!input || !qr) return;

  input.value = qr.message;
  hideQuickReplyDropdown();
  input.focus();
}

document.addEventListener("DOMContentLoaded", setupMessageInputShortcuts);

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const msg = input.value.trim();

  if (!selectedPhone) {
    notify("Please select a chat first.", "warning");
    return;
  }

  if (!msg) return;

  try {
    const res = await fetch(`${BASE}/api/send`, {
      method: "POST",
     headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ phone: selectedPhone, message: msg })
    });

    const data = await res.json();

    if (!res.ok || !data.success) {
      notify(data.error || "Message send failed", "error");
      return;
    }

    input.value = "";
    await loadChats();
    await openChat(selectedPhone, false);
  } catch (error) {
    console.error("Frontend send error:", error);
    notify("Message send failed. Check browser console and Railway logs.", "error");
  }
}

async function takeChat(phone) {
  if (!phone) return;

  // ✅ Assign chat
  const assignRes = await fetch(`${BASE}/api/assign-chat`, {
    method: "POST",
   headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      phone,
      agent: "assign"
    })
  });

  const assignData = await assignRes.json();

  if (!assignData.success) {
    notify(assignData.error || "Failed to take chat", "error");
    await loadChats();
    return;
  }

  // ✅ Switch to agent mode
  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
   headers: authHeaders({ "Content-Type": "application/json" }),
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
   headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      phone,
      agent: null
    })
  });

  // back to bot
  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
   headers: authHeaders({ "Content-Type": "application/json" }),
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
    notify("Please select a chat first.", "warning");
    return;
  }

  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
   headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ phone: selectedPhone, mode: "bot" })
  });

  notify("Chat switched back to bot mode.", "success");
  await loadChats();
  await openChat(selectedPhone, false);
}

// =========================
// AGENT MANAGEMENT
// =========================
async function loadCallbacks() {
  showLoadingState("callbackTableBody", 7);
  try {
    const res = await fetch(`${BASE}/api/callbacks`, {
      headers: authHeaders()
    });

    const data = await res.json();

    if (!data.success) {
      console.error("Callbacks load failed:", data.error);
      return;
    }

    const tbody = document.getElementById("callbackTableBody");

    if (!tbody) return;

    const callbacks = data.callbacks || [];

    const callbackCounts = callbacks.reduce((acc, item) => {
  const status = item.status || "pending";
  acc[status] = (acc[status] || 0) + 1;
  acc.all = (acc.all || 0) + 1;
  return acc;
}, { all: 0 });

document.getElementById("callbackCount_all").textContent = callbackCounts.all || 0;
document.getElementById("callbackCount_pending").textContent = callbackCounts.pending || 0;
document.getElementById("callbackCount_called").textContent = callbackCounts.called || 0;
document.getElementById("callbackCount_not_responded").textContent = callbackCounts.not_responded || 0;
document.getElementById("callbackCount_follow_up_required").textContent = callbackCounts.follow_up_required || 0;
document.getElementById("callbackCount_converted").textContent = callbackCounts.converted || 0;

const filteredCallbacks =
  currentCallbackFilter === "all"
    ? callbacks
    : callbacks.filter(item => item.status === currentCallbackFilter);

   if (!filteredCallbacks.length) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align:center; color:var(--muted); padding:24px;">
            No callback requests found
          </td>
        </tr>
      `;
      markLoaded("callbackTableBody");
      return;
    }

   tbody.innerHTML = filteredCallbacks.map(item => `
      <tr>
        <td>
          ${escapeHtml(item.name || "-")}
          ${
            Number(item.request_count || 1) > 1
              ? `<div class="repeat-badge">Again #${item.request_count}</div>`
              : ""
          }
        </td>

        <td>${escapeHtml(item.phone || "-")}</td>

        <td>${escapeHtml(prettyProgramName(item.program || "-"))}</td>
       <td>${formatDateTime(item.updated_at)}</td>

        <td>
          <select
            class="callback-select"
            id="callbackStatus_${item.id}"
          >
            <option value="pending" ${item.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="called" ${item.status === "called" ? "selected" : ""}>Called</option>
            <option value="not_responded" ${item.status === "not_responded" ? "selected" : ""}>Not Responded</option>
            <option value="follow_up_required" ${item.status === "follow_up_required" ? "selected" : ""}>Follow-up Required</option>
            <option value="converted" ${item.status === "converted" ? "selected" : ""}>Converted</option>
          </select>
        </td>

        <td>
          <textarea
            class="callback-notes"
            id="callbackNotes_${item.id}"
            placeholder="Add call notes..."
          >${escapeHtml(item.notes || "")}</textarea>
        </td>

        <td>
          <button
            class="primary-btn"
            onclick="updateCallback(${item.id})"
          >
            Save
          </button>
        </td>
      </tr>
    `).join("");
    markLoaded("callbackTableBody");

  } catch (error) {
    console.error("loadCallbacks error:", error);
  }
}

function setCallbackFilter(status, button) {
  currentCallbackFilter = status;

  document
    .querySelectorAll(".callback-filter-btn")
    .forEach(btn => btn.classList.remove("active-filter"));

  if (button) {
    button.classList.add("active-filter");
  }

  loadCallbacks();
}

function toDateTimeLocal(value) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  const offset = date.getTimezoneOffset();
  const localDate = new Date(date.getTime() - offset * 60000);

  return localDate.toISOString().slice(0, 16);
}

async function updateCallback(id) {
  try {
    const status = document.getElementById(`callbackStatus_${id}`)?.value;
    const notes = document.getElementById(`callbackNotes_${id}`)?.value;
    const next_followup_at =
      document.getElementById(`callbackFollowup_${id}`)?.value || null;

    console.log("Saving callback", {
  id,
  status,
  notes,
  next_followup_at
});

    const res = await fetch(`${BASE}/api/callbacks/${id}`, {
      method: "PUT",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        status,
        notes,
        next_followup_at
      })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to update callback", "error");
      return;
    }

    loadCallbacks();
  } catch (error) {
    console.error("updateCallback error:", error);
    notify("Callback update failed", "error");
  }
}

// =========================
// SETTINGS TABS
// =========================
function showSettingsTab(tab, btn) {
  document.querySelectorAll(".settings-tab-panel").forEach(panel => panel.classList.add("hidden"));
  document.querySelectorAll(".settings-tab-btn").forEach(b => b.classList.remove("active-filter"));

  if (tab === "quickReplies") {
    document.getElementById("quickRepliesTab").classList.remove("hidden");
  } else if (tab === "systemHealth") {
    document.getElementById("systemHealthTab").classList.remove("hidden");
    loadSystemHealth();
  }

  if (btn) btn.classList.add("active-filter");
}

// =========================
// QUICK REPLIES
// =========================
let quickReplies = [];

async function loadQuickReplies() {
  showLoadingState("quickRepliesTableBody", 3);
  try {
    const res = await fetch(`${BASE}/api/quick-replies`, {
      headers: authHeaders()
    });

    const data = await res.json();
    if (!data.success) return;

    quickReplies = data.quickReplies || [];

    const tbody = document.getElementById("quickRepliesTableBody");

    tbody.innerHTML = quickReplies.length
      ? quickReplies.map(qr => `
        <tr>
          <td>/${escapeHtml(qr.shortcut)}</td>
          <td>${escapeHtml(qr.message)}</td>
          <td class="agent-action-icons">
            <span class="icon-action" onclick="openQuickReplyModal(${qr.id})" title="Edit">✎</span>
            <span class="icon-action" onclick="deleteQuickReply(${qr.id})" title="Delete">🗑</span>
          </td>
        </tr>
      `).join("")
      : `
        <tr>
          <td colspan="3" style="text-align:center; color:var(--muted); padding:24px;">
            No quick replies yet. Click "Add Quick Reply" to create one.
          </td>
        </tr>
      `;

    markLoaded("quickRepliesTableBody");
  } catch (error) {
    console.error("loadQuickReplies error:", error);
  }
}

function openQuickReplyModal(id = null) {
  const existing = id ? quickReplies.find(qr => qr.id === id) : null;

  const overlay = document.createElement("div");
  overlay.className = "confirm-modal-overlay";
  overlay.innerHTML = `
    <div class="confirm-modal-card">
      <p style="font-weight:700; font-size:16px;">${existing ? "Edit quick reply" : "Add quick reply"}</p>

      <label class="field-label">Shortcut (typed after "/")</label>
      <input id="qrShortcut" class="prompt-input" type="text" placeholder="fee" value="${existing ? escapeHtml(existing.shortcut) : ""}" />

      <label class="field-label">Message</label>
      <textarea id="qrMessage" class="prompt-input" rows="4" placeholder="Type the full reply here...">${existing ? escapeHtml(existing.message) : ""}</textarea>

      <div class="confirm-modal-actions">
        <button class="ghost-btn" data-action="cancel">Cancel</button>
        <button class="primary-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  overlay.querySelector("#qrShortcut").focus();

  overlay.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    if (!action) return;

    if (action === "cancel") {
      overlay.remove();
      return;
    }

    if (action === "save") {
      await saveQuickReply(existing?.id || null, overlay);
    }
  });
}

async function saveQuickReply(id, overlay) {
  const shortcut = overlay.querySelector("#qrShortcut").value.trim();
  const message = overlay.querySelector("#qrMessage").value.trim();

  if (!shortcut || !message) {
    notify("Please fill in both fields", "warning");
    return;
  }

  try {
    const res = await fetch(
      id ? `${BASE}/api/quick-replies/${id}` : `${BASE}/api/quick-replies`,
      {
        method: id ? "PUT" : "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ shortcut, message })
      }
    );

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to save quick reply", "error");
      return;
    }

    notify("Quick reply saved", "success");
    overlay.remove();
    await loadQuickReplies();
  } catch (error) {
    console.error("saveQuickReply error:", error);
    notify("Failed to save quick reply", "error");
  }
}

async function deleteQuickReply(id) {
  const confirmed = await customConfirm("Delete this quick reply?");
  if (!confirmed) return;

  try {
    const res = await fetch(`${BASE}/api/quick-replies/${id}`, {
      method: "DELETE",
      headers: authHeaders()
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to delete quick reply", "error");
      return;
    }

    notify("Quick reply deleted", "success");
    await loadQuickReplies();
  } catch (error) {
    console.error("deleteQuickReply error:", error);
    notify("Failed to delete quick reply", "error");
  }
}

// =========================
// SYSTEM HEALTH
// =========================
function formatRelativeTime(isoString) {
  if (!isoString) return "Never";

  const diffMs = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diffMs / 60000);

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m ago`;

  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function healthCard(label, valueHtml, statusClass, meta = "") {
  return `
    <div class="stat-card ${statusClass}">
      <div class="label">${escapeHtml(label)}</div>
      <div class="value" style="font-size:20px;">${valueHtml}</div>
      ${meta ? `<div class="meta">${escapeHtml(meta)}</div>` : ""}
    </div>
  `;
}

async function loadSystemHealth() {
  const grid = document.getElementById("systemHealthGrid");
  if (!grid) return;

  grid.innerHTML = `<div class="loading-spinner"><span></span><span></span><span></span></div>`;

  try {
    const res = await fetch(`${BASE}/api/system-health`, {
      headers: authHeaders()
    });

    const data = await res.json();

    if (!data.success) {
      grid.innerHTML = `<p style="color:var(--muted);">Failed to load system health.</p>`;
      return;
    }

    const h = data.health;
    const cards = [];

    cards.push(healthCard(
      "Database",
      h.database.ok ? `✅ Connected` : `❌ Down`,
      h.database.ok ? "live" : "danger",
      h.database.ok ? `${h.database.responseMs}ms response` : h.database.error
    ));

    cards.push(healthCard(
      "WhatsApp API",
      h.whatsappApi.ok ? `✅ Reachable` : `❌ Error`,
      h.whatsappApi.ok ? "live" : "danger",
      h.whatsappApi.ok ? `${h.whatsappApi.responseMs}ms response` : h.whatsappApi.error
    ));

    const lastMsgMinutes = h.lastIncomingMessageAt
      ? (Date.now() - new Date(h.lastIncomingMessageAt).getTime()) / 60000
      : Infinity;
    cards.push(healthCard(
      "Last Incoming Message",
      lastMsgMinutes <= 120 ? `✅ ${formatRelativeTime(h.lastIncomingMessageAt)}` : `⚠️ ${formatRelativeTime(h.lastIncomingMessageAt)}`,
      lastMsgMinutes <= 120 ? "live" : "warning",
      "Webhook is working if this updates regularly"
    ));

    const followupOk = h.backgroundJobs.followupCheckerLastRunAt &&
      (Date.now() - h.backgroundJobs.followupCheckerLastRunAt) < 15 * 60 * 1000;
    const callbackOk = h.backgroundJobs.callbackOfferCheckerLastRunAt &&
      (Date.now() - h.backgroundJobs.callbackOfferCheckerLastRunAt) < 15 * 60 * 1000;

    cards.push(healthCard(
      "Background Jobs",
      (followupOk && callbackOk) ? "✅ Running" : "⚠️ Check",
      (followupOk && callbackOk) ? "live" : "warning",
      `Follow-up: ${h.backgroundJobs.followupCheckerLastRunAt ? formatRelativeTime(new Date(h.backgroundJobs.followupCheckerLastRunAt).toISOString()) : "Never"} · Callback offer: ${h.backgroundJobs.callbackOfferCheckerLastRunAt ? formatRelativeTime(new Date(h.backgroundJobs.callbackOfferCheckerLastRunAt).toISOString()) : "Never"}`
    ));

    cards.push(healthCard(
      "Recent Send Failures",
      h.recentSendFailures === 0 ? "✅ None" : `⚠️ ${h.recentSendFailures}`,
      h.recentSendFailures === 0 ? "live" : "warning",
      "In the last hour"
    ));

    const envOk = h.envVars.WHATSAPP_TOKEN && h.envVars.JWT_SECRET && h.envVars.DATABASE_URL;
    cards.push(healthCard(
      "Required Settings",
      envOk ? "✅ All set" : "❌ Missing",
      envOk ? "live" : "danger",
      envOk
        ? "WHATSAPP_TOKEN, JWT_SECRET, DATABASE_URL all configured"
        : `Missing: ${Object.entries(h.envVars).filter(([, v]) => !v).map(([k]) => k).join(", ")}`
    ));

    cards.push(healthCard(
      "Server Uptime",
      formatUptime(h.server.uptimeSeconds),
      "performance",
      `Memory: ${h.server.memoryMb} MB · In-memory sessions: ${h.server.inMemoryUserStates}`
    ));

    cards.push(healthCard(
      "Media Storage",
      `${h.mediaStorage.mb} MB`,
      "performance",
      `${h.mediaStorage.fileCount} files saved`
    ));

    if (h.rowCounts) {
      cards.push(healthCard(
        "Database Size",
        `${h.rowCounts.messages.toLocaleString()} messages`,
        "performance",
        `${h.rowCounts.users.toLocaleString()} users · ${h.rowCounts.chats.toLocaleString()} chats`
      ));
    }

    grid.innerHTML = cards.join("");
  } catch (error) {
    console.error("loadSystemHealth error:", error);
    grid.innerHTML = `<p style="color:var(--muted);">Failed to load system health.</p>`;
  }
}

async function loadAgents() {
  showLoadingState("agentsTableBody", 6);
  try {
    const res = await fetch(`${BASE}/api/agents`, {
      headers: authHeaders()
    });

    const data = await res.json();

    if (!data.success) return;

    const tbody = document.getElementById("agentsTableBody");

    tbody.innerHTML = data.agents.map(agent => `
      <tr>
        <td>${escapeHtml(agent.name)}</td>

        <td>${escapeHtml(agent.username)}</td>

        <td>
          <span class="role-badge role-${agent.role}">
            ${escapeHtml(agent.role)}
          </span>
        </td>

        <td>
          ${
            agent.can_view_dashboard
              ? "✅ Yes"
              : "❌ No"
          }
        </td>

        <td>
          <label class="switch" title="${agent.active ? "Active" : "Inactive"}">
            <input
              type="checkbox"
              ${agent.active ? "checked" : ""}
              onchange="toggleAgentStatus(${agent.id}, ${agent.active})"
            />
            <span class="slider"></span>
          </label>
        </td>

    <td class="agent-action-icons">
  <span class="icon-action" onclick="openEditAgentModal(${agent.id})" title="Edit agent">✎</span>
  <span class="icon-action" onclick="resetAgentPassword(${agent.id})" title="Reset password">🔑</span>
</td>
      </tr>
    `).join("");
    markLoaded("agentsTableBody");

  } catch (error) {
    console.error("Load agents error:", error);
  }
}

async function createAgent() {
  const name = document.getElementById("newAgentName").value.trim();

  const username = document.getElementById("newAgentUsername").value.trim();

  const password = document.getElementById("newAgentPassword").value.trim();

  const role = document.getElementById("newAgentRole").value;

  const can_view_dashboard =
    document.getElementById("newAgentDashboardAccess").checked;

  if (!name || !username || !password) {
    notify("Please fill all required fields", "warning");
    return;
  }

  try {
    const res = await fetch(`${BASE}/api/agents`, {
      method: "POST",

      headers: authHeaders({
        "Content-Type": "application/json"
      }),

      body: JSON.stringify({
        name,
        username,
        password,
        role,
        can_view_dashboard
      })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to create agent", "error");
      return;
    }

    notify("Agent created successfully", "success");

    document.getElementById("newAgentName").value = "";
    document.getElementById("newAgentUsername").value = "";
    document.getElementById("newAgentPassword").value = "";
    document.getElementById("newAgentDashboardAccess").checked = false;

    loadAgents();

  } catch (error) {
    console.error("Create agent error:", error);

    notify("Failed to create agent", "error");
  }
}

async function toggleAgentStatus(id, currentStatus) {
  try {
    const res = await fetch(`${BASE}/api/agents/${id}`, {
      method: "PUT",

      headers: authHeaders({
        "Content-Type": "application/json"
      }),

      body: JSON.stringify({
        active: !currentStatus
      })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to update agent", "error");
      return;
    }

    loadAgents();

  } catch (error) {
    console.error("Toggle agent status error:", error);
  }
}

async function openEditAgentModal(id) {
  const agent = (await getAgentById(id));

  if (!agent) {
    notify("Agent not found", "error");
    return;
  }

  const roles = ["admin", "chat_agent", "call_agent"];

  const overlay = document.createElement("div");
  overlay.className = "confirm-modal-overlay";
  overlay.innerHTML = `
    <div class="confirm-modal-card">
      <p style="font-weight:700; font-size:16px;">Edit agent</p>

      <label class="field-label">Name</label>
      <input id="editAgentName" class="prompt-input" type="text" value="${escapeHtml(agent.name)}" />

      <label class="field-label">Username</label>
      <div class="field-readonly">${escapeHtml(agent.username)}</div>

      <label class="field-label">Role</label>
      <select id="editAgentRole" class="prompt-input">
        ${roles.map(r => `<option value="${r}" ${r === agent.role ? "selected" : ""}>${r}</option>`).join("")}
      </select>

      <label class="field-toggle-row">
        <span>Dashboard access</span>
        <label class="switch">
          <input type="checkbox" id="editAgentDashboard" ${agent.can_view_dashboard ? "checked" : ""} />
          <span class="slider"></span>
        </label>
      </label>

      <label class="field-label">New password</label>
      <input id="editAgentPassword" class="prompt-input" type="password" placeholder="Leave blank to keep current" />

      <div class="confirm-modal-actions">
        <button class="ghost-btn" data-action="cancel">Cancel</button>
        <button class="primary-btn" data-action="save">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  overlay.addEventListener("click", async (event) => {
    const action = event.target.dataset.action;
    if (!action) return;

    if (action === "cancel") {
      overlay.remove();
      return;
    }

    if (action === "save") {
      await saveEditedAgent(id, overlay);
    }
  });
}

async function saveEditedAgent(id, overlay) {
  const newName = overlay.querySelector("#editAgentName").value.trim();
  const newRole = overlay.querySelector("#editAgentRole").value;
  const dashboardAccess = overlay.querySelector("#editAgentDashboard").checked;
  const newPassword = overlay.querySelector("#editAgentPassword").value;

  if (!newName) {
    notify("Please enter a name", "warning");
    return;
  }

  if (newPassword && newPassword.length < 6) {
    notify("Password must be at least 6 characters", "warning");
    return;
  }

  try {
    const res = await fetch(`${BASE}/api/agents/${id}`, {
      method: "PUT",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        name: newName,
        role: newRole,
        can_view_dashboard: dashboardAccess
      })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to update agent", "error");
      return;
    }

    if (newPassword) {
      const pwRes = await fetch(`${BASE}/api/agents/${id}/password`, {
        method: "PUT",
        headers: authHeaders({
          "Content-Type": "application/json"
        }),
        body: JSON.stringify({ password: newPassword })
      });

      const pwData = await pwRes.json();

      if (!pwData.success) {
        notify(pwData.error || "Agent updated, but password reset failed", "error");
        overlay.remove();
        loadAgents();
        return;
      }
    }

    notify("Agent updated", "success");
    overlay.remove();
    loadAgents();

  } catch (error) {
    console.error("Edit agent error:", error);
    notify("Failed to update agent", "error");
  }
}

async function resetAgentPassword(id) {
  const newPassword = await customPrompt("Enter new password:", { inputType: "password" });

  if (!newPassword) return;

  if (newPassword.length < 6) {
    notify("Password must be at least 6 characters", "warning");
    return;
  }

  try {
    const res = await fetch(`${BASE}/api/agents/${id}/password`, {
      method: "PUT",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        password: newPassword
      })
    });

    const data = await res.json();

    if (!data.success) {
      notify(data.error || "Failed to reset password", "error");
      return;
    }

    notify("Password reset successfully", "success");

  } catch (error) {
    console.error("Password reset error:", error);
    notify("Failed to reset password", "error");
  }
}

async function getAgentById(id) {
  try {
    const res = await fetch(`${BASE}/api/agents`, {
      headers: authHeaders()
    });

    const data = await res.json();

    if (!data.success) return null;

    return data.agents.find(agent => Number(agent.id) === Number(id));
  } catch (error) {
    console.error("Get agent error:", error);
    return null;
  }
}

function notify(message, type = "info") {
  let container = document.getElementById("toastContainer");
  if (!container) {
    container = document.createElement("div");
    container.id = "toastContainer";
    container.className = "toast-container";
    document.body.appendChild(container);
  }

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add("toast-out");
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function customConfirm(message) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";
    overlay.innerHTML = `
      <div class="confirm-modal-card">
        <p>${escapeHtml(message)}</p>
        <div class="confirm-modal-actions">
          <button class="ghost-btn" data-action="cancel">Cancel</button>
          <button class="primary-btn" data-action="ok">Yes</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      overlay.remove();
      resolve(action === "ok");
    });
  });
}

function customPrompt(message, { defaultValue = "", inputType = "text", choices = null } = {}) {
  return new Promise(resolve => {
    const overlay = document.createElement("div");
    overlay.className = "confirm-modal-overlay";

    const fieldHtml = choices
      ? `<select id="promptInput" class="prompt-input">
          ${choices.map(c => `<option value="${escapeHtml(c)}" ${c === defaultValue ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
        </select>`
      : `<input id="promptInput" class="prompt-input" type="${inputType}" value="${escapeHtml(defaultValue)}" />`;

    overlay.innerHTML = `
      <div class="confirm-modal-card">
        <p>${escapeHtml(message)}</p>
        ${fieldHtml}
        <div class="confirm-modal-actions">
          <button class="ghost-btn" data-action="cancel">Cancel</button>
          <button class="primary-btn" data-action="ok">OK</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const input = overlay.querySelector("#promptInput");
    input.focus();
    if (input.select) input.select();

    function finish(result) {
      overlay.remove();
      resolve(result);
    }

    overlay.addEventListener("click", (event) => {
      const action = event.target.dataset.action;
      if (!action) return;
      finish(action === "ok" ? input.value : null);
    });

    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") finish(input.value);
      if (event.key === "Escape") finish(null);
    });
  });
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

function formatDuration(seconds) {
  seconds = Number(seconds || 0);

  if (!seconds) return "0m";

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
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

function formatDayLabel(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = startOfDay(new Date());
  const target = startOfDay(date);
  const diffDays = Math.round((today - target) / 86400000);

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function titleCase(str) {
  return String(str)
    .split(" ")
    .map(word => word ? word.charAt(0).toUpperCase() + word.slice(1) : "")
    .join(" ");
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

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("messageInput");

  if (input) {
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage();
    });
  }

  checkAuth();

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

    if (
      currentAgent &&
      (currentAgent.role === "admin" || currentAgent.role === "chat_agent")
    ) {
      loadChats();

      if (selectedPhone && selectedPhone === data.phone) {
        openChat(selectedPhone, false, true);
      }
    }
  });

  setInterval(() => {
    if (!authToken) return;

    if (currentSection === "dashboard") {
      loadDashboard(currentRange);
    } else if (currentSection === "agent") {
      loadChats();
    } else if (currentSection === "agents") {
      loadAgents();
    } else if (currentSection === "callbacks") {
      loadCallbacks();
    }
  }, 15000);
});

function applyCustomRange() {
  const start = document.getElementById("startDate")?.value;
  const end = document.getElementById("endDate")?.value;

  if (!start || !end) {
    notify("Please select both dates.", "warning");
    return;
  }

  if (new Date(start) > new Date(end)) {
    notify("Start date cannot be greater than end date.", "warning");
    return;
  }

  currentRange = `custom&start=${start}&end=${end}`;

  document
    .querySelectorAll(".range-btn")
    .forEach(btn => btn.classList.remove("active"));

  loadDashboard(currentRange);
}

function exportDashboardData() {
  const url = `${BASE}/api/export-leads?range=${currentRange}`;

  fetch(url, {
    headers: authHeaders()
  })
    .then(response => {
      if (!response.ok) {
        throw new Error("Export failed");
      }
      return response.blob();
    })
    .then(blob => {
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");

      const today = new Date().toISOString().slice(0, 10);

      link.href = downloadUrl;
      link.download = `mul-nexus-leads-export-${today}.csv`;

      document.body.appendChild(link);
      link.click();

      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
    })
    .catch(error => {
      console.error("Export error:", error);
      notify("Export failed. Please try again.", "error");
    });
}

// =========================
// MY PROFILE
// =========================

async function openProfileModal() {
  const modal = document.getElementById("profileModal");
  const profileMessage = document.getElementById("profileMessage");
  const passwordMessage = document.getElementById("passwordMessage");

  if (profileMessage) {
    profileMessage.innerText = "";
    profileMessage.className = "profile-message";
  }

  if (passwordMessage) {
    passwordMessage.innerText = "";
    passwordMessage.className = "profile-message";
  }

  if (modal) {
    modal.classList.remove("hidden");
  }

  try {
    const response = await fetch(`${BASE}/api/profile`, {
      headers: authHeaders()
    });

    const data = await response.json();

    if (!data.success) {
      if (profileMessage) {
        profileMessage.innerText = data.error || "Failed to load profile";
        profileMessage.className = "profile-message error";
      }
      return;
    }

    const profile = data.profile;

    document.getElementById("profileName").value = profile.name || "";
    document.getElementById("profileUsername").value = profile.username || "";
    document.getElementById("profileRole").value = profile.role || "";
    document.getElementById("profileDesignation").value = profile.designation || "";
    document.getElementById("profileEmail").value = profile.email || "";
    document.getElementById("profilePhone").value = profile.phone || "";
  } catch (error) {
    console.error("Open profile error:", error);

    if (profileMessage) {
      profileMessage.innerText = "Failed to load profile";
      profileMessage.className = "profile-message error";
    }
  }
}

function closeProfileModal() {
  const modal = document.getElementById("profileModal");

  if (modal) {
    modal.classList.add("hidden");
  }
}

async function saveProfile() {
  const profileMessage = document.getElementById("profileMessage");

  if (profileMessage) {
    profileMessage.innerText = "";
    profileMessage.className = "profile-message";
  }

  const payload = {
    name: document.getElementById("profileName").value.trim(),
    designation: document.getElementById("profileDesignation").value.trim(),
    email: document.getElementById("profileEmail").value.trim(),
    phone: document.getElementById("profilePhone").value.trim()
  };

  try {
    const response = await fetch(`${BASE}/api/profile`, {
      method: "PUT",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.success) {
      if (profileMessage) {
        profileMessage.innerText = data.error || "Failed to update profile";
        profileMessage.className = "profile-message error";
      }
      return;
    }

    currentAgent = {
      ...currentAgent,
      name: data.profile.name
    };

    if (profileMessage) {
      profileMessage.innerText = "Profile updated successfully";
      profileMessage.className = "profile-message success";
    }
  } catch (error) {
    console.error("Save profile error:", error);

    if (profileMessage) {
      profileMessage.innerText = "Failed to update profile";
      profileMessage.className = "profile-message error";
    }
  }
}

async function changeOwnPassword() {
  const passwordMessage = document.getElementById("passwordMessage");

  if (passwordMessage) {
    passwordMessage.innerText = "";
    passwordMessage.className = "profile-message";
  }

  const payload = {
    currentPassword: document.getElementById("currentPassword").value,
    newPassword: document.getElementById("newPassword").value,
    confirmPassword: document.getElementById("confirmPassword").value
  };

  try {
    const response = await fetch(`${BASE}/api/profile/password`, {
      method: "PUT",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (!data.success) {
      if (passwordMessage) {
        passwordMessage.innerText = data.error || "Failed to change password";
        passwordMessage.className = "profile-message error";
      }
      return;
    }

    document.getElementById("currentPassword").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("confirmPassword").value = "";

    if (passwordMessage) {
      passwordMessage.innerText = "Password changed successfully";
      passwordMessage.className = "profile-message success";
    }
  } catch (error) {
    console.error("Change password error:", error);

    if (passwordMessage) {
      passwordMessage.innerText = "Failed to change password";
      passwordMessage.className = "profile-message error";
    }
  }
}

// =========================
// LOGOUT
// =========================

function logoutAgent() {
  localStorage.removeItem("mul_nexus_token");
  sessionStorage.removeItem("mul_nexus_token");

  authToken = null;
  currentAgent = null;

  document.getElementById("loginOverlay").style.display = "flex";

  location.reload();
}
