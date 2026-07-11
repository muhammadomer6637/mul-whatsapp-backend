const selectedPhone = localStorage.getItem("selected_chat_phone");

const token =
  sessionStorage.getItem("mul_nexus_token") ||
  localStorage.getItem("mul_nexus_token");

if (!token) {
  window.location.href = "/live";
}

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`
  };
}

function handleAuthFailure(res) {
  if (res.status === 401) {
    window.location.href = "/live";
    return true;
  }
  return false;
}

function goBack() {
  window.location.href = "/live";
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

function formatTimeOnly(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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

let renderedMessageIds = new Set();
let lastRenderedDayLabel = null;

function buildMessageRowHtml(message, isLatest) {
  let content = "";

  if ((message.type === "image" || message.mime_type?.includes("image")) && message.media_url) {
    content = `
      <img src="${escapeHtml(message.media_url)}"
           style="max-width:220px;border-radius:10px;cursor:pointer;display:block"
           onclick="window.open('${escapeHtml(message.media_url)}','_blank')" />
    `;
  } else if ((message.type === "document" || message.mime_type?.includes("pdf")) && message.media_url) {
    content = `
      <a href="${escapeHtml(message.media_url)}" target="_blank" style="color:#dbeafe;text-decoration:underline">
        📄 ${escapeHtml(message.file_name || "Open Document")}
      </a>
    `;
  } else if ((message.type === "video" || message.mime_type?.includes("video")) && message.media_url) {
    content = `
      <video controls style="max-width:240px;border-radius:10px;display:block">
        <source src="${escapeHtml(message.media_url)}">
      </video>
    `;
  } else if ((message.type === "audio" || message.mime_type?.includes("audio")) && message.media_url) {
    content = `
      <audio controls style="max-width:240px">
        <source src="${escapeHtml(message.media_url)}">
      </audio>
    `;
  } else {
    content = escapeHtml(message.text || message.type || "");
  }

  const dayLabel = formatDayLabel(message.created_at);
  let divider = "";
  if (dayLabel !== lastRenderedDayLabel) {
    divider = `<div class="date-divider"><span>${escapeHtml(dayLabel)}</span></div>`;
    lastRenderedDayLabel = dayLabel;
  }

  const senderClass =
    message.sender === "user" ? "user" : message.sender === "agent" ? "agent" : "bot";

  const isOutgoing = senderClass !== "user";
  const sentTick = isOutgoing ? ` <span class="sent-tick">✓</span>` : "";

  return `
    ${divider}
    <div class="message-row ${senderClass}${isLatest ? " message-in" : ""}">
      <div class="bubble">
        ${content}
        <div class="msg-time">
          ${formatTimeOnly(message.created_at)}${sentTick}
        </div>
      </div>
    </div>
  `;
}

async function loadChatInfo() {
  try {
    const res = await fetch(`/api/chats?search=${encodeURIComponent(selectedPhone)}`, {
      headers: authHeaders()
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) return;

    const chat = data.chats.find(item => item.phone === selectedPhone);
    const initials = (chat?.name || "S").trim().charAt(0).toUpperCase();

    const avatarEl = document.getElementById("chatAvatar");
    if (avatarEl) avatarEl.textContent = initials;

    document.getElementById("chatName").textContent =
      chat?.name || selectedPhone || "Unknown Student";

    document.getElementById("chatMeta").textContent =
      `${chat?.program || "Program Not Selected"} · ${selectedPhone}`;
    document.getElementById("chatActions").innerHTML =
  chat?.status === "agent_waiting"
    ? `<button class="take-btn" onclick="takeChat()">Take Chat</button>`
    : "";

  } catch (error) {
    console.error("loadChatInfo error:", error);
  }
}

async function loadMessages() {
  if (!selectedPhone) {
    window.location.href = "/live";
    return;
  }

  try {
    const res = await fetch(`/api/messages/${selectedPhone}`, {
      headers: authHeaders()
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    const box = document.getElementById("messagesBox");

    if (!data.success || !data.messages.length) {
      if (!renderedMessageIds.size) {
        box.innerHTML = `
          <div class="loading">
            No messages found.
          </div>
        `;
      }
      return;
    }

    const oldScrollHeight = box.scrollHeight;
    const oldScrollTop = box.scrollTop;
    const oldClientHeight = box.clientHeight;
    const wasNearBottom = oldScrollHeight - oldScrollTop - oldClientHeight < 80;

    const isFirstLoad = renderedMessageIds.size === 0;

    if (isFirstLoad) {
      lastRenderedDayLabel = null;
      box.innerHTML = data.messages.map((message, index) => {
        const isLatest = index === data.messages.length - 1;
        return buildMessageRowHtml(message, isLatest);
      }).join("");
      data.messages.forEach(m => renderedMessageIds.add(m.id));
      box.scrollTop = box.scrollHeight;
    } else {
      const newMessages = data.messages.filter(m => !renderedMessageIds.has(m.id));
      if (newMessages.length) {
        const appendHtml = newMessages.map((message, index) => {
          const isLatest = index === newMessages.length - 1;
          return buildMessageRowHtml(message, isLatest);
        }).join("");
        box.insertAdjacentHTML("beforeend", appendHtml);
        newMessages.forEach(m => renderedMessageIds.add(m.id));

        if (wasNearBottom) {
          box.scrollTop = box.scrollHeight;
        }
      }
    }

  } catch (error) {
    console.error("loadMessages error:", error);
  }
}

function insertQuickReply(type) {
  const input = document.getElementById("messageInput");

  const replies = {
    fee: `You can view the complete fee structure here:
https://www.mul.edu.pk/en/fee-calculator`,

    apply: `You can apply online through the official admission portal:
https://admission.mul.edu.pk/`,

    scholarship: `Scholarship details are available here:
https://www.mul.edu.pk/en/scholarships-and-fee-concession`,

    docs: `Required documents:
• Academic Result / Transcript
• Student CNIC or B-Form
• Father/Guardian CNIC
• Domicile
• Recent Photographs`
  };

  input.value = replies[type] || "";
  input.focus();
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const message = input.value.trim();

  if (!message) return;

  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        phone: selectedPhone,
        message
      })
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Message send failed");
      return;
    }

    input.value = "";
    await loadMessages();

  } catch (error) {
    console.error("sendMessage error:", error);
    alert("Message send failed");
  }
}

async function switchBackToBot() {
  if (!confirm("Shift this chat back to bot?")) return;

  try {
    const res = await fetch("/api/switch-mode", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        phone: selectedPhone,
        mode: "bot"
      })
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Failed to switch back to bot");
      return;
    }

    alert("Chat shifted back to bot.");
    window.location.href = "/live";

  } catch (error) {
    console.error("switchBackToBot error:", error);
    alert("Failed to switch back to bot");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  loadChatInfo();
  loadMessages();
  setInterval(loadMessages, 5000);

  const input = document.getElementById("messageInput");

  input.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      sendMessage();
    }
  });
});

async function takeChat() {
  try {
    await fetch("/api/assign-chat", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        phone: selectedPhone,
        agent: "assign"
      })
    });

    await fetch("/api/switch-mode", {
      method: "POST",
      headers: authHeaders({
        "Content-Type": "application/json"
      }),
      body: JSON.stringify({
        phone: selectedPhone,
        mode: "agent"
      })
    });

    await loadChatInfo();
    await loadMessages();

    alert("Chat assigned successfully.");
  } catch (error) {
    console.error("takeChat error:", error);
    alert("Failed to take chat.");
  }
}
