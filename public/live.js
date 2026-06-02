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

    const chats = await res.json();

    console.log("Chats JSON:", JSON.stringify(chats, null, 2));

  } catch (err) {
    console.error(err);
  }
}

loadChats();
