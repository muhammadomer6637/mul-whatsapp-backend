let currentFilter = "all";
let searchTerm = "";
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

 data.chats
  .filter(chat => {

    const searchableText = `
      ${chat.name || ""}
      ${chat.phone || ""}
      ${chat.program || ""}
    `.toLowerCase();

    if (
      searchTerm &&
      !searchableText.includes(searchTerm.toLowerCase())
    ) {
      return false;
    }

    if (currentFilter === "waiting") {
      return chat.status === "agent_waiting";
    }

    if (currentFilter === "active") {
      return chat.status === "active";
    }

    return true;
  })

    if (currentFilter === "waiting") {
      return chat.status === "agent_waiting";
    }

    if (currentFilter === "active") {
      return chat.status === "active";
    }

    return true;
  })
  .forEach(chat => {
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

    loadChats();
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

    loadChats();
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

    loadChats();
  });

document
  .getElementById("searchInput")
  .addEventListener("input", (e) => {

    searchTerm = e.target.value;

    loadChats();
  });

function openChat(phone) {
  localStorage.setItem("selected_chat_phone", phone);
  window.location.href = "/live-chat";
}
