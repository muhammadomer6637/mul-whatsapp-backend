async function loadChats() {
  try {
    const token = localStorage.getItem("agentToken");

    const res = await fetch("/api/chats", {
      headers: {
        Authorization: `Bearer ${token}`
      }
    });

    const chats = await res.json();

    console.log("Chats:", chats);

  } catch (err) {
    console.error(err);
  }
}

loadChats();
