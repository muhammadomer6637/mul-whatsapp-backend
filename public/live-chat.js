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

function buildTickHtml(status) {
  if (status === "read") return `<span class="sent-tick tick-read">✓✓</span>`;
  if (status === "delivered") return `<span class="sent-tick">✓✓</span>`;
  return `<span class="sent-tick">✓</span>`;
}

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
  const sentTick = isOutgoing ? ` ${buildTickHtml(message.status)}` : "";

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

let quickReplies = [];
let quickReplyMatches = [];
let quickReplyActiveIndex = 0;

async function loadQuickReplies() {
  try {
    const res = await fetch("/api/quick-replies", {
      headers: authHeaders()
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();
    if (!data.success) return;

    quickReplies = data.quickReplies || [];
  } catch (error) {
    console.error("loadQuickReplies error:", error);
  }
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
      // Let the browser's default behavior insert a line break in the textarea.
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

async function sendMediaFile(file) {
  if (!file) return;

  const fileInput = document.getElementById("mediaFileInput");
  const attachBtn = document.querySelector(".attach-btn");
  const maxSizeBytes = 20 * 1024 * 1024;

  if (file.size > maxSizeBytes) {
    alert("File is too large. Maximum size is 20MB.");
    if (fileInput) fileInput.value = "";
    return;
  }

  if (attachBtn) attachBtn.disabled = true;

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("phone", selectedPhone);

    const res = await fetch("/api/send-media", {
      method: "POST",
      headers: authHeaders(),
      body: formData
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Failed to send file");
      return;
    }

    await loadMessages();

  } catch (error) {
    console.error("sendMediaFile error:", error);
    alert("Failed to send file");
  } finally {
    if (attachBtn) attachBtn.disabled = false;
    if (fileInput) fileInput.value = "";
  }
}

async function addLeadDetails() {
  if (!selectedPhone) return;

  const name = prompt("Student's name:");
  if (name === null) return;

  const program = prompt("Interested program:");
  if (program === null) return;

  if (!name.trim() || !program.trim()) {
    alert("Name and program are both required.");
    return;
  }

  try {
    const res = await fetch("/api/update-lead", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        phone: selectedPhone,
        name: name.trim(),
        program: program.trim()
      })
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Failed to save lead details");
      return;
    }

    const menu = document.getElementById("funnelMenu");
    if (menu) menu.remove();

    await loadChatInfo();
  } catch (error) {
    console.error("addLeadDetails error:", error);
    alert("Failed to save lead details");
  }
}

async function toggleFunnelMenu() {
  const existing = document.getElementById("funnelMenu");
  if (existing) {
    existing.remove();
    return;
  }

  const header = document.querySelector(".chat-header");
  if (!header) return;

  let funnel = {};

  try {
    const res = await fetch(`/api/funnel-status/${selectedPhone}`, {
      headers: authHeaders()
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();
    if (data.success) funnel = data.funnel || {};
  } catch (error) {
    console.error("load funnel status error:", error);
  }

  const registeredIcon = funnel.registered_at ? "✓" : "○";
  const processingIcon = funnel.processing_fee_paid_at ? "✓" : "○";
  const documentsIcon = funnel.documents_submitted_at ? "✓" : "○";
  const admissionFeeIcon = funnel.admission_fee_paid_at ? "✓" : "○";

  const menu = document.createElement("div");
  menu.id = "funnelMenu";
  menu.className = "funnel-menu-card";

  menu.innerHTML = `
    <button class="funnel-menu-item" onclick="addLeadDetails()">
      ✏️ Add Lead Details
    </button>
    <hr>
    <button class="funnel-menu-item" ${funnel.registered_at ? "disabled" : `onclick="updateFunnelStage('registered')"`}>
      ${registeredIcon} Registered
    </button>
    <button class="funnel-menu-item" ${funnel.processing_fee_paid_at ? "disabled" : `onclick="updateFunnelStage('processing_fee_paid')"`}>
      ${processingIcon} Processing Fee Paid
    </button>
    <button class="funnel-menu-item" ${funnel.documents_submitted_at ? "disabled" : `onclick="updateFunnelStage('documents_submitted')"`}>
      ${documentsIcon} Documents Submitted
    </button>
    <button class="funnel-menu-item" ${funnel.admission_fee_paid_at ? "disabled" : `onclick="updateFunnelStage('admission_fee_paid')"`}>
      ${admissionFeeIcon} Admission Fee Paid
    </button>
    <hr>
    <button class="funnel-menu-item" onclick="assignToCallAgent()">
      Assign To Call Agent
    </button>
  `;

  header.appendChild(menu);
}

async function updateFunnelStage(stage) {
  if (!selectedPhone) return;

  try {
    const res = await fetch("/api/funnel-status", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ phone: selectedPhone, stage })
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Failed to update funnel status");
      return;
    }

    const menu = document.getElementById("funnelMenu");
    if (menu) menu.remove();

    await loadChatInfo();
  } catch (error) {
    console.error("updateFunnelStage error:", error);
    alert("Funnel status update failed.");
  }
}

async function assignToCallAgent() {
  if (!selectedPhone) return;

  if (!confirm("Assign this chat to the call agent team? The student will be moved back to the bot menu.")) return;

  try {
    const res = await fetch("/api/assign-call-agent", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ phone: selectedPhone })
    });

    if (handleAuthFailure(res)) return;

    const data = await res.json();

    if (!data.success) {
      alert(data.error || "Failed to assign to call agent");
      return;
    }

    const menu = document.getElementById("funnelMenu");
    if (menu) menu.remove();

    alert("Assigned to call agent team.");
    window.location.href = "/live";
  } catch (error) {
    console.error("assignToCallAgent error:", error);
    alert("Failed to assign to call agent.");
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
  loadQuickReplies();
  setInterval(loadMessages, 5000);

  setupMessageInputShortcuts();
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
