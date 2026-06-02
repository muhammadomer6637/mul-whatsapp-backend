async function loadChats() {
  try {
    const token =
      sessionStorage.getItem("mul_nexus_token") ||
      localStorage.getItem("mul_nexus_token");

    const res = await fetch("/api/chats", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const data = await res.json();

    if (!data.success) {
      console.error(data);
      return;
    }

    const wrap = document.getElementById("chatList");
    wrap.innerHTML = "";

    data.chats.forEach(chat => {
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

  } catch (err) {
    console.error("loadChats error:", err);
  }
}

loadChats();

function openChat(phone) {
  localStorage.setItem("selected_chat_phone", phone);

  alert("Chat selected: " + phone);
}
