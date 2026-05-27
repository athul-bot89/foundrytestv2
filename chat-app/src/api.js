export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export async function sendMessage(messages, userId, accessToken) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messages, userId }),
  });

  if (!res.ok) {
    let err = {};
    try { err = await res.json(); } catch { /* non-JSON response */ }
    throw new ApiError(
      err.error || `Server error (${res.status})`,
      err.code || "UNKNOWN",
      res.status
    );
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
export async function streamMessage(messages, userId, onDelta, signal, accessToken) {
  const res = await fetch("/api/chat/stream", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messages, userId }),
    signal,
  });

  if (!res.ok) {
    let err = {};
    try { err = await res.json(); } catch { /* non-JSON response */ }
    throw new ApiError(
      err.error || `Server error (${res.status})`,
      err.code || "UNKNOWN",
      res.status
    );
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = "";
  let annotations = [];
  let messageId = "";
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
      if (payload === "[DONE]") return { text: fullText, annotations, messageId };
      try {
        const parsed = JSON.parse(payload);
        if (parsed.error) throw new ApiError(parsed.error, parsed.code || "STREAM_ERROR", 0);
        if (parsed.delta) {
          if (parsed.replace === true) {
            // Server sends final sanitized full text
            fullText = parsed.delta;
            if (parsed.annotations) annotations = parsed.annotations;
            if (parsed.messageId) messageId = parsed.messageId;
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
}

/**
 * Send feedback (like/dislike) for a message.
 * @param {number} messageIndex - Index of the message in the conversation
 * @param {string} rating - "like" or "dislike"
 * @param {string} messageContent - The message content (will be truncated server-side)
 * @param {string} userId - The user ID
 * @param {string} accessToken - Bearer token
 * @param {string} threadId - The conversation thread ID
 * @param {string} messageId - The backend message ID
 * @returns {Promise<object>}
 */
export async function sendFeedback(messageIndex, rating, messageContent, userId, accessToken, threadId, messageId) {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ messageIndex, rating, messageContent, userId, threadId, messageId }),
  });

  if (!res.ok) {
    let err = {};
    try { err = await res.json(); } catch { /* non-JSON response */ }
    throw new ApiError(
      err.error || `Server error (${res.status})`,
      err.code || "UNKNOWN",
      res.status
    );
  }

  return await res.json();
}
