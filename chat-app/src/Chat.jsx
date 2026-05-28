import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { streamMessage, sendFeedback } from "./api";
import "./Chat.css";

/**
 * Parse citation markers like 【4:1†source.pdf】 from the text.
 * Returns { cleanText, citations } where citations is an array of
 * { index, id, source } objects and cleanText has markers replaced
 * with placeholder tokens like [^1].
 */
function parseCitations(text, annotations = []) {
  const citationRegex = /【([^】]*?)†([^】]*?)】/g;
  const citations = [];
  const seen = new Map();
  let lastIdx = null;
  let annotationIndex = 0;

  const cleanText = text.replace(citationRegex, (match, id, source) => {
    const key = source || id;
    if (!seen.has(key)) {
      seen.set(key, citations.length + 1);
      let displayName = source || id;
      if (displayName === "source" || !displayName) {
        if (annotations[annotationIndex] && annotations[annotationIndex].filename) {
          displayName = annotations[annotationIndex].filename;
        } else {
          displayName = `Source ${citations.length + 1}`;
        }
      }
      citations.push({ index: citations.length + 1, id, source: displayName });
    }
    annotationIndex++;
    const idx = seen.get(key);
    if (idx === lastIdx) return "";
    lastIdx = idx;
    return `<cite-ref data-idx="${idx}"></cite-ref>`;
  });

  return { cleanText, citations };
}

function MessageContent({ content, role, annotations }) {
  const [refsExpanded, setRefsExpanded] = useState(false);

  if (role === "user" || role === "error") {
    if (role === "error") return <span className="error-text">{content}</span>;
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a target="_blank" rel="noopener noreferrer" {...props} />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    );
  }

  const { cleanText, citations } = parseCitations(content, annotations);

  const markdownWithCitations = cleanText.replace(
    /<cite-ref data-idx="(\d+)"><\/cite-ref>/g,
    (_, idx) => `<span class="citation-badge">${idx}</span>`
  );

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          a: ({ node, ...props }) => (
            <a target="_blank" rel="noopener noreferrer" {...props} />
          ),
        }}
      >
        {markdownWithCitations}
      </ReactMarkdown>
      {citations.length > 0 && (
        <div className="citations-section">
          <button
            className="citations-toggle"
            onClick={() => setRefsExpanded(!refsExpanded)}
            aria-expanded={refsExpanded}
          >
            <div className="citations-toggle-left">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                <polyline points="14,2 14,8 20,8"/>
              </svg>
              <span>{citations.length} reference{citations.length > 1 ? "s" : ""}</span>
            </div>
            <svg
              className={`citations-chevron ${refsExpanded ? "expanded" : ""}`}
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <polyline points="6 9 12 15 18 9"/>
            </svg>
          </button>
          {refsExpanded && (
            <div className="citations-list">
              {citations.map((c) => (
                <div key={c.index} className="citation-card">
                  <div className="citation-card-icon">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>
                      <polyline points="14,2 14,8 20,8"/>
                      <line x1="16" y1="13" x2="8" y2="13"/>
                      <line x1="16" y1="17" x2="8" y2="17"/>
                    </svg>
                  </div>
                  <div className="citation-card-content">
                    <span className="citation-card-title">{c.source}</span>
                  </div>
                  <span className="citation-card-number">{c.index}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

function AgentAvatar() {
  return (
    <div className="avatar agent-avatar">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor"/>
      </svg>
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="avatar user-avatar">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" fill="currentColor"/>
      </svg>
    </div>
  );
}

function Chat({ token, email, onSignOut }) {
  const userId = email;

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [feedbackGiven, setFeedbackGiven] = useState({});
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const threadIdRef = useRef(crypto.randomUUID());

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent, loading]);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 150) + "px";
    }
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();
    const text = input.trim();
    if (!text || loading) return;

    const userMessage = { role: "user", content: text };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);
    setStreamingContent("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await streamMessage(
        updatedMessages,
        userId,
        (accumulated) => setStreamingContent(accumulated),
        controller.signal,
        token
      );
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: result.text, annotations: result.annotations, messageId: result.messageId },
      ]);
    } catch (err) {
      if (err.name === "AbortError") {
        if (streamingContent) {
          setMessages((prev) => [
            ...prev,
            { role: "assistant", content: streamingContent },
          ]);
        }
      } else {
        const isAuth = err.code === "AUTH_FAILED" || err.code === "AUTH_MISSING" || err.status === 401;
        if (isAuth) {
          setMessages((prev) => [
            ...prev,
            { role: "error", content: "Session expired. Please sign out and sign in again." },
          ]);
        } else {
          setMessages((prev) => [
            ...prev,
            { role: "error", content: `Error: ${err.message}` },
          ]);
        }
        console.error(`[Chat] ${err.code || "ERROR"}:`, err.message);
      }
    } finally {
      setLoading(false);
      setStreamingContent("");
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleNewChat = () => {
    if (abortRef.current) abortRef.current.abort();
    setMessages([]);
    setStreamingContent("");
    setLoading(false);
    setFeedbackGiven({});
    threadIdRef.current = crypto.randomUUID();
  };

  const handleFeedback = async (messageIndex, rating, content, messageId) => {
    setFeedbackGiven((prev) => ({ ...prev, [messageIndex]: rating }));
    try {
      await sendFeedback(messageIndex, rating, content, userId, token, threadIdRef.current, messageId || "");
    } catch (err) {
      console.error("[Feedback] Failed to send:", err.message);
    }
  };

  return (
    <div className="chat-container">
      {/* Header */}
      <div className="chat-header">
        <div className="header-left">
          <div className="agent-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
              <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor"/>
            </svg>
          </div>
          <span className="agent-name">Agent Chat</span>
        </div>
        <div className="header-right">
          <button className="new-chat-btn" onClick={handleNewChat} title="New chat">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
            <span>New chat</span>
          </button>
          <button className="sign-out-btn" onClick={onSignOut} title="Sign out">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/>
              <polyline points="16 17 21 12 16 7"/>
              <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {/* Messages Area */}
      <div className="chat-messages">
        {messages.length === 0 && !loading && (
          <div className="empty-state">
            <div className="empty-icon">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                <path d="M12 2L14.09 8.26L20 9.27L15.55 13.97L16.91 20L12 16.9L7.09 20L8.45 13.97L4 9.27L9.91 8.26L12 2Z" fill="currentColor"/>
              </svg>
            </div>
            <h2>How can I help you today?</h2>
            <p>ask me anything about the company policies</p>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`message-row ${msg.role}`}>
            {msg.role === "assistant" && <AgentAvatar />}
            {msg.role === "user" && <div className="avatar-spacer" />}
            <div className={`message-bubble ${msg.role}`}>
              <MessageContent content={msg.content} role={msg.role} annotations={msg.annotations} />
              {msg.role === "assistant" && (
                <div className="feedback-buttons">
                  <button
                    className={`feedback-btn${feedbackGiven[i] === "like" ? " selected" : ""}`}
                    onClick={() => handleFeedback(i, "like", msg.content, msg.messageId)}
                    title="Like"
                    disabled={feedbackGiven[i] === "like"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 9V5a3 3 0 00-3-3l-4 9v11h11.28a2 2 0 002-1.7l1.38-9a2 2 0 00-2-2.3H14z"/>
                      <path d="M7 22H4a2 2 0 01-2-2v-7a2 2 0 012-2h3"/>
                    </svg>
                  </button>
                  <button
                    className={`feedback-btn${feedbackGiven[i] === "dislike" ? " selected" : ""}`}
                    onClick={() => handleFeedback(i, "dislike", msg.content, msg.messageId)}
                    title="Dislike"
                    disabled={feedbackGiven[i] === "dislike"}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M10 15v4a3 3 0 003 3l4-9V2H5.72a2 2 0 00-2 1.7l-1.38 9a2 2 0 002 2.3H10z"/>
                      <path d="M17 2h2.67A2.31 2.31 0 0122 4v7a2.31 2.31 0 01-2.33 2H17"/>
                    </svg>
                  </button>
                </div>
              )}
            </div>
            {msg.role === "user" && <UserAvatar />}
            {msg.role === "assistant" && <div className="avatar-spacer" />}
          </div>
        ))}

        {/* Streaming message */}
        {loading && streamingContent && (
          <div className="message-row assistant">
            <AgentAvatar />
            <div className="message-bubble assistant">
              <MessageContent content={streamingContent} role="assistant" />
            </div>
            <div className="avatar-spacer" />
          </div>
        )}

        {/* Typing indicator */}
        {loading && !streamingContent && (
          <div className="message-row assistant">
            <AgentAvatar />
            <div className="typing-indicator">
              <span></span>
              <span></span>
              <span></span>
            </div>
            <div className="avatar-spacer" />
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="chat-input-wrapper">
        {loading && (
          <button className="stop-btn" onClick={handleStop}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
            </svg>
            Stop generating
          </button>
        )}
        <form className="chat-input-area" onSubmit={handleSubmit}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            disabled={loading}
            rows={1}
          />
          <button
            type="submit"
            className="send-btn"
            disabled={loading || !input.trim()}
            title="Send message"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M22 2L11 13M22 2L15 22L11 13M22 2L2 9L11 13"/>
            </svg>
          </button>
        </form>
        <div className="input-hint">
          Press Enter to send, Shift+Enter for new line
        </div>
      </div>
    </div>
  );
}

export default Chat;
