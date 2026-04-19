const BASE = "https://mul-whatsapp-backend-production.up.railway.app";

let selectedPhone = null;

// Navigation
function showSection(id) {
  document.querySelectorAll(".section").forEach(s => s.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

// ================= DASHBOARD =================

async function loadDashboard(range = "24h") {
  const res = await fetch(`${BASE}/api/dashboard?range=${range}`);
  const data = await res.json();

  const stats = data.stats;

  document.getElementById("stats").innerHTML = `
    <div class="card">Conversations<br>${stats.conversationsStarted}</div>
    <div class="card">Unread Chats<br>${stats.unreadConversations}</div>
    <div class="card">Unread Msgs<br>${stats.totalUnreadMessages}</div>
    <div class="card">Agent Waiting<br>${stats.agentWaiting}</div>
    <div class="card">Active Now<br>${stats.activeWithAgent}</div>
  `;

  // Programs
  document.getElementById("programs").innerHTML =
    "<tr><th>Program</th><th>Inquiries</th></tr>" +
    data.topPrograms.map(p =>
      `<tr><td>${p.program}</td><td>${p.inquiries}</td></tr>`
    ).join("");

  // Leads
  document.getElementById("leads").innerHTML =
    "<tr><th>Name</th><th>Program</th><th>Phone</th></tr>" +
    data.recentLeads.map(l =>
      `<tr><td>${l.name}</td><td>${l.program}</td><td>${l.phone}</td></tr>`
    ).join("");
}

// ================= AGENT PANEL =================

async function loadChats() {
  const res = await fetch(`${BASE}/api/chats`);
  const data = await res.json();

  const html = data.chats.map(c => `
    <div class="chat-item" onclick="openChat('${c.phone}')">
      ${c.name || c.phone}
      ${c.unread_count > 0 ? `<span class="unread">${c.unread_count}</span>` : ""}
      <br><small>${c.program || ""}</small>
    </div>
  `).join("");

  document.getElementById("chatList").innerHTML = html;
}

async function openChat(phone) {
  selectedPhone = phone;

  await fetch(`${BASE}/api/mark-read`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone })
  });

  const res = await fetch(`${BASE}/api/messages/${phone}`);
  const data = await res.json();

  const html = data.messages.map(m => `
    <div class="message ${m.sender}">
      ${m.text || m.type}
    </div>
  `).join("");

  document.getElementById("messages").innerHTML = html;
}

async function sendMessage() {
  const msg = document.getElementById("messageInput").value;

  await fetch(`${BASE}/api/send`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      phone: selectedPhone,
      message: msg
    })
  });

  document.getElementById("messageInput").value = "";
  openChat(selectedPhone);
}

async function switchToBot() {
  await fetch(`${BASE}/api/switch-mode`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      phone: selectedPhone,
      mode: "bot"
    })
  });

  alert("Switched to bot");
}

// Auto load
loadDashboard();
loadChats();
