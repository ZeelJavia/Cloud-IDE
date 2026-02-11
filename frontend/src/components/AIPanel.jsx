import React, { useState, useRef, useEffect } from "react";
import {
  FiSend,
  FiUser,
  FiZap,
  FiCode,
  FiRefreshCw,
  FiTrash2,
  FiCopy,
  FiCheck,
} from "react-icons/fi";
import {
  VscCopilot,
} from "react-icons/vsc";
import { api, tokenManager } from "../lib/api";
import "./AIPanel.css";

const AIPanel = ({ activeFile, fileContents, onContentUpdate }) => {
  const [messages, setMessages] = useState([]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [chatMode, setChatMode] = useState("chat"); // 'chat' or 'generate'
  const [copiedMessageId, setCopiedMessageId] = useState(null);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async () => {
    if (!inputMessage.trim() || isLoading) return;

    const userMessage = {
      id: Date.now(),
      type: "user",
      content: inputMessage,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setInputMessage("");
    setIsLoading(true);

    // Build file context string (plain text) for backend system prompt
    const buildContext = () => {
      if (!activeFile) return "";
      const raw = fileContents[activeFile.path] || "";
      const MAX = 8000;
      const trimmed =
        raw.length > MAX ? raw.slice(0, MAX) + "\n/* ...truncated... */" : raw;
      const lang = getLanguageFromFileName(activeFile.name);
      return `File: ${activeFile.name}\nLanguage: ${lang}\nContent:\n${trimmed}`;
    };

    // Convert local messages to backend chat history
    const toHistory = (msgs) =>
      msgs
        .filter((m) => m.type === "user" || m.type === "assistant")
        .slice(-10)
        .map((m) => ({
          role: m.type === "user" ? "user" : "assistant",
          content: m.content,
        }));

    try {
      if (chatMode === "generate") {
        // Generation endpoint expects { prompt, projectName?, saveToProject? }
        const contextString = buildContext();
        const prompt =
          (contextString
            ? `Using the following existing file context (if relevant):\n\n${contextString}\n\nTask:\n`
            : "") + inputMessage;

        const token = tokenManager.getToken();
        const data = await api.aiGenerate({ prompt }, token);

        // Backend returns { files: [{ filename, content }], rawResponse }
        if (Array.isArray(data.files) && data.files.length) {
          const newMsgs = data.files.map((f) => ({
            id: Date.now() + Math.random(),
            type: "assistant",
            content: f.content,
            timestamp: new Date().toISOString(),
            isCode: true,
            language: getLanguageFromFileName(f.filename),
            genFilename: f.filename,
          }));
          setMessages((prev) => [...prev, ...newMsgs]);
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 1,
              type: "assistant",
              content: data.rawResponse || "No files returned.",
              timestamp: new Date().toISOString(),
              isCode: false,
            },
          ]);
        }
      } else {
        // Chat endpoint expects { message, history?, context? }
        const body = {
          message: inputMessage,
          history: toHistory(messages),
          context: buildContext() || undefined,
        };
        const token = tokenManager.getToken();
        const data = await api.aiChat(body, token);
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            type: "assistant",
            content: data.response || "No response",
            timestamp: new Date().toISOString(),
            isCode: false,
          },
        ]);
      }
    } catch (error) {
      console.error("AI request error:", error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 2,
          type: "error",
          content: `Error: ${error.message}`,
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([]);
  };

  const copyToClipboard = async (content, messageId) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedMessageId(messageId);
      setTimeout(() => setCopiedMessageId(null), 2000);
    } catch (error) {
      console.error("Failed to copy:", error);
    }
  };

  const insertCodeIntoEditor = (code) => {
    if (activeFile && onContentUpdate) {
      const currentContent = fileContents[activeFile.path] || "";
      const newContent = currentContent + "\n\n" + code;
      onContentUpdate(activeFile.path, newContent);
    }
  };

  const getLanguageFromFileName = (fileName) => {
    if (!fileName) return "javascript";
    const ext = fileName.split(".").pop()?.toLowerCase();
    const languageMap = {
      js: "javascript",
      jsx: "javascript",
      ts: "typescript",
      tsx: "typescript",
      html: "html",
      css: "css",
      py: "python",
      java: "java",
      cpp: "cpp",
      c: "c",
      php: "php",
      rb: "ruby",
      go: "go",
      rs: "rust",
    };
    return languageMap[ext] || "plaintext";
  };

  const formatMessage = (content) => {
    // Simple markdown-like formatting
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    const inlineCodeRegex = /`([^`]+)`/g;

    let formatted = content;

    // Replace code blocks
    formatted = formatted.replace(codeBlockRegex, (match, language, code) => {
      return `<pre class="code-block" data-language="${
        language || "text"
      }"><code>${code.trim()}</code></pre>`;
    });

    // Replace inline code
    formatted = formatted.replace(
      inlineCodeRegex,
      '<code class="inline-code">$1</code>'
    );

    // Replace line breaks
    formatted = formatted.replace(/\n/g, "<br>");

    return formatted;
  };

  const quickPrompts = [
    {
      icon: <FiCode size={16} />,
      label: "Explain Code",
      prompt: "Explain what this code does and how it works:",
    },
    {
      icon: <FiZap size={16} />,
      label: "Optimize",
      prompt: "Optimize this code for better performance:",
    },
    {
      icon: <FiRefreshCw size={16} />,
      label: "Refactor",
      prompt: "Refactor this code to make it cleaner and more maintainable:",
    },
    {
      icon: <VscCopilot size={16} />,
      label: "Add Comments",
      prompt: "Add helpful comments to this code:",
    },
  ];

  return (
    <div className="ai-panel">
      <div className="ai-header">
        <div className="ai-title">
          <VscCopilot size={20} />
          <h3>AI Assistant</h3>
        </div>

        <div className="ai-modes">
          <button
            className={`mode-btn ${chatMode === "chat" ? "active" : ""}`}
            onClick={() => setChatMode("chat")}
          >
            Chat
          </button>
          <button
            className={`mode-btn ${chatMode === "generate" ? "active" : ""}`}
            onClick={() => setChatMode("generate")}
          >
            Generate
          </button>
        </div>

        <button className="clear-btn" onClick={clearChat} title="Clear chat">
          <FiTrash2 size={16} />
        </button>
      </div>

      <div className="ai-content">
        {messages.length === 0 ? (
          <div className="ai-welcome">
            <div className="welcome-icon">
              <VscCopilot size={48} />
            </div>
            <h4>AI Assistant Ready</h4>
            <p>
              {chatMode === "chat"
                ? "Ask me anything about your code or programming in general!"
                : "Describe what you want to generate and I'll create code for you!"}
            </p>

            {activeFile && (
              <div className="quick-prompts">
                <p className="quick-prompts-title">
                  Quick actions for {activeFile.name}:
                </p>
                <div className="prompt-buttons">
                  {quickPrompts.map((prompt, index) => (
                    <button
                      key={index}
                      className="prompt-btn"
                      onClick={() => setInputMessage(prompt.prompt)}
                    >
                      {prompt.icon}
                      {prompt.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="messages-container">
            {messages.map((message) => (
              <div key={message.id} className={`message ${message.type}`}>
                <div className="message-header">
                  <div className="message-icon">
                    {message.type === "user" ? (
                      <FiUser size={16} />
                    ) : message.type === "error" ? (
                      <span className="error-icon">⚠️</span>
                    ) : (
                      <VscCopilot size={16} />
                    )}
                  </div>
                  <span className="message-time">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                  {message.type === "assistant" && (
                    <div className="message-actions">
                      <button
                        className="action-btn"
                        onClick={() =>
                          copyToClipboard(message.content, message.id)
                        }
                        title="Copy"
                      >
                        {copiedMessageId === message.id ? (
                          <FiCheck size={14} />
                        ) : (
                          <FiCopy size={14} />
                        )}
                      </button>
                      {message.isCode && activeFile && (
                        <button
                          className="action-btn"
                          onClick={() => insertCodeIntoEditor(message.content)}
                          title="Insert into editor"
                        >
                          <FiCode size={14} />
                        </button>
                      )}
                    </div>
                  )}
                </div>

                <div className="message-content">
                  {message.isCode ? (
                    <div>
                      {message.genFilename && (
                        <div className="gen-filename-tag">
                          {message.genFilename}
                        </div>
                      )}
                      <pre className="code-block">
                        <code>{message.content}</code>
                      </pre>
                    </div>
                  ) : (
                    <div
                      dangerouslySetInnerHTML={{
                        __html: formatMessage(message.content),
                      }}
                    />
                  )}
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="message assistant loading">
                <div className="message-header">
                  <div className="message-icon">
                    <VscCopilot size={16} />
                  </div>
                  <span className="message-time">Now</span>
                </div>
                <div className="message-content">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className="ai-input">
        {activeFile && (
          <div className="context-info">
            <span className="context-file">📄 {activeFile.name}</span>
            <span className="context-mode">
              {chatMode === "generate" ? "⚡ Generate" : "💬 Chat"}
            </span>
          </div>
        )}

        <div className="input-container">
          <textarea
            ref={inputRef}
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={
              chatMode === "generate"
                ? "Describe the code you want to generate..."
                : "Ask me anything about your code..."
            }
            rows={3}
            disabled={isLoading}
          />
          <button
            className="send-btn"
            onClick={sendMessage}
            disabled={!inputMessage.trim() || isLoading}
          >
            <FiSend size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AIPanel;
