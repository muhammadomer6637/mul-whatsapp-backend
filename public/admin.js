.message-row.user {
  justify-content: flex-start;
}

.message-row.agent,
.message-row.bot {
  justify-content: flex-end;
}

.message-bubble {
  max-width: 70%;
  padding: 12px 14px;
  border-radius: 16px;
  font-size: 14px;
}

.message-row.user .message-bubble {
  background: #1f2c44;
}

.message-row.agent .message-bubble {
  background: linear-gradient(135deg, #2f7df6, #56a5ff);
}
