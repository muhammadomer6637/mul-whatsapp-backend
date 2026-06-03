const selectedPhone = localStorage.getItem("selected_chat_phone");

const token =
  sessionStorage.getItem("mul_nexus_token") ||
  localStorage.getItem("mul_nexus_token");

function authHeaders(extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${token}`
  };
}

function goBack() {
  window.location.href = "/live";
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

async function loadChatInfo() {
  try {
    const res = await fetch("/api/chats", {
      headers: authHeaders()
    });

    const data = await res.json();

    if (!data.success) return;

    const chat = data.chats.find(item => item.phone === selectedPhone);

    document.getElementById("chatName").textContent =
      chat?.name || selectedPhone || "Unknown Student";

    document.getElementById("chatMeta").textContent =
      `${chat?.program || "Program Not Selected"} · ${selectedPhone}`;

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

    const data = await res.json();

    const box = document.getElementById("messagesBox");

    if (!data.success || !data.messages.length) {
      box.innerHTML = `
        <div class="loading">
          No messages found.
        </div>
      `;
      return;
    }

    box.innerHTML = data.messages.map(message => {
      const senderClass =
        message.sender === "user"
          ? "user"
          : message.sender === "agent"
            ? "agent"
            : "bot";

      return `
        <div class="message-row ${senderClass}">
          <div class="bubble">
            ${message.text || message.type || ""}
            <div class="msg-time">
              ${formatDateTime(message.created_at)}
            </div>
          </div>
        </div>
      `;
    }).join("");

    box.scrollTop = box.scrollHeight;

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
