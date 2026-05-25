export async function sendMessage(messages, userId) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, userId }),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Server error");
  }

  const data = await res.json();
  return data.reply;
}

/**
 * Stream a message from the agent via SSE.
 * @param {Array} messages - The conversation messages
 * @param {string} userId - The user ID
 * @param {function} onDelta - Callback called with each text chunk
 * @param {AbortSignal} signal - AbortController signal to cancel the stream
 * @returns {Promise<string>} The full accumulated response text
 */
export async function streamMessage(messages, userId, onDelta, signal) {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, userId }),
    signal,
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Server error");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const payload = line.slice(6);
      if (payload === "[DONE]") return fullText;
      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.delta) {
          if (parsed.replace === true) {
            // Server sends final sanitized full text
            fullText = parsed.delta;
          } else {
            // Individual token delta — append
            fullText += parsed.delta;
          }
          onDelta(fullText);
        }
      } catch (e) {
        if (e.message && !e.message.includes("JSON")) throw e;
      }
    }
  }

  return fullText;
}
