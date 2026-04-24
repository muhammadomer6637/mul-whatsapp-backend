let selectedPhone = null;

async function loadChats() {
  const res = await fetch("/api/chats");
  const data = await res.json();

  const list = document.getElementById("chatList");
  list.innerHTML = "";

  document.getElementById("chatCountBadge").innerText = data.chats.length;

  data.chats.forEach(chat => {
    const div = document.createElement("div");
    div.className = "chat-item";
    div.innerText = `${chat.name || chat.phone} - ${chat.last_message || ""}`;
    div.onclick = () => openChat(chat.phone);
    list.appendChild(div);
  });
}

async function openChat(phone) {
  selectedPhone = phone;

  const res = await fetch(`/api/messages/${phone}`);
  const data = await res.json();

  const box = document.getElementById("messages");
  box.innerHTML = "";

  data.messages.forEach(msg => {
    const row = document.createElement("div");
    row.className = "message-row " + msg.sender;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";
    bubble.innerText = msg.text;

    row.appendChild(bubble);
    box.appendChild(row);
  });

  setTimeout(() => {
    box.scrollTop = box.scrollHeight;
  }, 50);
}

async function sendMessage() {
  const input = document.getElementById("messageInput");
  const text = input.value;

  if (!text || !selectedPhone) return;

  await fetch("/api/send", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      phone: selectedPhone,
      message: text
    })
  });

  input.value = "";
  openChat(selectedPhone);
}

async function switchToBot() {
  if (!selectedPhone) return;

  await fetch("/api/switch-mode", {
    method: "POST",
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({
      phone: selectedPhone,
      mode: "bot"
    })
  });

  alert("Switched to bot");
}

loadChats();
setInterval(loadChats, 5000);
