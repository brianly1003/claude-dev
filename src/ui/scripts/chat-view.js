// Main chat view JavaScript
const vscode = acquireVsCodeApi();

// UI Elements
const messagesContainer = document.getElementById("messages");
const messageInput = document.getElementById("messageInput");
const sendButton = document.getElementById("sendButton");
const mcpModal = document.getElementById("mcpModalOverlay");
const mcpServerBtn = document.getElementById("mcpServerBtn");
const mcpCloseBtn = document.getElementById("mcpCloseBtn");
const customServerModal = document.getElementById("customServerModalOverlay");
const addServerBtn = document.getElementById("addServerBtn");
const customServerCloseBtn = document.getElementById("customServerCloseBtn");
const customServerForm = document.getElementById("customServerForm");
const advancedToggle = document.getElementById("advancedToggle");
const cancelCustomServer = document.getElementById("cancelCustomServer");

// State
let isWaiting = false;
let isGenerating = false;
let isManuallyStopped = false;
let isInitialized = false;

// Popular MCP servers data
const popularServers = [
  {
    name: "Context7",
    icon: "📖",
    description: "Up-to-date Code Docs For Any Project",
    category: "documentation",
  },
  {
    name: "Sequential Thinking",
    icon: "🧠",
    description: "Step-by-step reasoning capabilities",
    category: "reasoning",
  },
  {
    name: "Memory",
    icon: "🧠",
    description: "Knowledge graph storage",
    category: "storage",
  },
  {
    name: "Puppeteer",
    icon: "🎭",
    description: "Browser automation",
    category: "automation",
  },
  {
    name: "Fetch",
    icon: "🌐",
    description: "HTTP requests & web scraping",
    category: "networking",
  },
  {
    name: "Filesystem",
    icon: "📁",
    description: "File operations & management",
    category: "files",
  },
];

// === MCP Server Management ===

function showCustomServerForm() {
  hideMCPModal();
  resetCustomServerForm();
  customServerModal.classList.add("visible");

  document.querySelector(
    "#customServerModalOverlay .mcp-modal-title"
  ).textContent = "Add Custom MCP Server";
  document.querySelector("#saveCustomServer .mcp-btn-text").textContent =
    "Add Server";
}

function showEditServerForm(serverData) {
  console.log("Showing edit form with server data:", serverData);

  hideMCPModal();

  // Pre-populate form with existing data
  document.getElementById("serverName").value = serverData.name;
  document.getElementById("serverCommand").value = serverData.command;
  document.getElementById("serverArgs").value = serverData.args;
  document.getElementById("serverType").value = serverData.type;
  document.getElementById("serverEnv").value = serverData.env;

  // Store original name for updates
  document
    .getElementById("customServerForm")
    .setAttribute("data-original-name", serverData.originalName);

  // Update form title and button text
  document.querySelector(
    "#customServerModalOverlay .mcp-modal-title"
  ).textContent = "Edit MCP Server";
  document.querySelector("#saveCustomServer .mcp-btn-text").textContent =
    "Update Server";

  customServerModal.classList.add("visible");
  hideFormError();
}

function hideCustomServerForm() {
  customServerModal.classList.remove("visible");
}

function cancelCustomServerForm() {
  hideCustomServerForm();
  showMCPModal();
}

function resetCustomServerForm() {
  customServerForm.reset();
  hideFormError();
  setSubmitButtonState(false);

  const advancedSection = document.querySelector(".mcp-advanced-section");
  advancedSection.classList.remove("expanded");

  document
    .getElementById("customServerForm")
    .removeAttribute("data-original-name");
}

function toggleAdvancedConfig() {
  const advancedSection = document.querySelector(".mcp-advanced-section");
  advancedSection.classList.toggle("expanded");
}

function showFormError(message) {
  const errorDiv = document.getElementById("formError");
  errorDiv.textContent = message;
  errorDiv.style.display = "block";
}

function hideFormError() {
  const errorDiv = document.getElementById("formError");
  errorDiv.style.display = "none";
}

function setSubmitButtonState(loading) {
  const submitBtn = document.getElementById("saveCustomServer");
  const btnText = submitBtn.querySelector(".mcp-btn-text");
  const btnSpinner = submitBtn.querySelector(".mcp-btn-spinner");

  submitBtn.disabled = loading;
  btnText.style.display = loading ? "none" : "block";
  btnSpinner.style.display = loading ? "block" : "none";
}

function validateServerForm(formData) {
  const errors = [];

  if (!formData.name?.trim()) {
    errors.push("Server name is required");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.name.trim())) {
    errors.push(
      "Server name can only contain letters, numbers, hyphens, and underscores"
    );
  }

  if (!formData.command?.trim()) {
    errors.push("Command is required");
  }

  if (!formData.type) {
    errors.push("Connection type is required");
  }

  if (formData.env?.trim()) {
    const envLines = formData.env.split("\\n").filter((line) => line.trim());
    for (const line of envLines) {
      if (!line.includes("=") || line.startsWith("=")) {
        errors.push("Environment variables must be in KEY=value format");
        break;
      }
    }
  }

  return errors;
}

function parseEnvironmentVariables(envText) {
  if (!envText?.trim()) return {};

  const env = {};
  const lines = envText.split("\\n").filter((line) => line.trim());

  for (const line of lines) {
    const [key, ...valueParts] = line.split("=");
    if (key?.trim() && valueParts.length > 0) {
      env[key.trim()] = valueParts.join("=");
    }
  }

  return env;
}

function handleCustomServerSubmit(event) {
  event.preventDefault();
  hideFormError();

  const formData = {
    name: document.getElementById("serverName").value.trim(),
    command: document.getElementById("serverCommand").value.trim(),
    args: document.getElementById("serverArgs").value.trim(),
    type: document.getElementById("serverType").value,
    env: document.getElementById("serverEnv").value.trim(),
  };

  const errors = validateServerForm(formData);
  if (errors.length > 0) {
    showFormError(errors[0]);
    return;
  }

  const args = formData.args
    ? formData.args.split(/\\s+/).filter((arg) => arg)
    : [];
  const env = parseEnvironmentVariables(formData.env);

  const serverConfig = {
    name: formData.name,
    command: formData.command,
    args: args,
    type: formData.type,
    ...(Object.keys(env).length > 0 && { env }),
  };

  setSubmitButtonState(true);

  const originalName = document
    .getElementById("customServerForm")
    .getAttribute("data-original-name");

  if (originalName) {
    vscode.postMessage({
      type: "updateMCPServer",
      originalName: originalName,
      serverConfig: serverConfig,
    });
  } else {
    vscode.postMessage({
      type: "addCustomMCPServer",
      serverConfig: serverConfig,
    });
  }
}

// === MCP Modal Functions ===

function showMCPModal() {
  vscode.postMessage({ type: "openMCPModal" });
}

function hideMCPModal() {
  mcpModal.classList.remove("visible");
}

function renderPopularServers(configuredTools = [], configuredServers = [], installing = null) {
  const popularGrid = document.getElementById("popularServers");

  popularGrid.innerHTML = popularServers
    .map((server) => {
      const isInstalled =
        configuredTools.some(
          (tool) =>
            tool
              .toLowerCase()
              .includes(server.name.toLowerCase().replace(/\\s+/g, "")) ||
            tool.toLowerCase().includes(server.name.toLowerCase())
        ) ||
        configuredServers.some((configServer) => {
          const serverKey = server.name.toLowerCase().replace(/\\s+/g, "-");
          const displayName = configServer.displayName || configServer.name;
          return (
            configServer.name === serverKey ||
            displayName.toLowerCase() === server.name.toLowerCase()
          );
        });

      return `
            <div class="mcp-server-card ${isInstalled ? "installed" : ""}" 
                 data-server="${server.name}"
                 style="${
                   isInstalled ? "cursor: default;" : "cursor: pointer;"
                 }">
                <div class="mcp-install-status ${
                  isInstalled ? "installed" : "installing"
                } ${installing === server.name ? "installing" : ""}">
                    ${installing === server.name ? "Installing..." : (isInstalled ? "Installed" : "Install")}
                </div>
                <div class="mcp-server-icon">
                    ${server.icon || server.name.charAt(0).toUpperCase()}
                </div>
                <div class="mcp-server-name">${server.name}</div>
                <div class="mcp-server-description">${server.description}</div>
            </div>
        `;
    })
    .join("");

  const serverCards = popularGrid.querySelectorAll(".mcp-server-card");
  serverCards.forEach((card) => {
    const serverName = card.getAttribute("data-server");
    const isInstalled = card.classList.contains("installed");

    if (!isInstalled) {
      card.addEventListener("click", () =>
        handleServerInstallClick(serverName)
      );
    }
  });
}

function handleServerInstallClick(serverName) {
  console.log("Installing MCP server:", serverName);

  const card = document.querySelector(`[data-server="${serverName}"]`);
  if (!card) {
    console.error("Server card not found:", serverName);
    return;
  }

  const installStatus = card.querySelector(".mcp-install-status");
  const originalText = installStatus.textContent;

  installStatus.textContent = "Installing...";
  installStatus.classList.add("installing");
  card.style.pointerEvents = "none";
  card.style.opacity = "0.7";

  console.log("Sending install request for:", serverName);
  vscode.postMessage({
    type: "installMCPServer",
    serverName: serverName,
  });

  setTimeout(() => {
    if (installStatus.textContent === "Installing...") {
      console.warn("Installation timeout for:", serverName);
      installStatus.textContent = originalText;
      installStatus.classList.remove("installing");
      card.style.pointerEvents = "";
      card.style.opacity = "";
    }
  }, 10000);
}

function updateMCPModal(data) {
  console.log("Updating MCP Modal with data:", data);
  const configuredStatus = document.getElementById("configuredStatus");
  const configuredServers = document.getElementById("configuredServers");

  if (
    data.configured &&
    data.configuredServers &&
    data.configuredServers.length > 0
  ) {
    configuredStatus.textContent = `${data.configuredServers.length} configured`;
    configuredStatus.classList.add("configured");

    configuredServers.innerHTML = `
            <div class="mcp-configured-servers">
                ${data.configuredServers
                  .map((server) => {
                    const displayName = server.displayName || server.name;
                    const args = server.args ? server.args.join(" ") : "";

                    return `
                        <div class="mcp-configured-server">
                            <div class="mcp-configured-server-header">
                                <div class="mcp-configured-server-info">
                                    <div class="mcp-configured-server-icon">
                                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M9 11l3 3L22 4"/>
                                            <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
                                        </svg>
                                    </div>
                                    <h3 class="mcp-configured-server-name">${displayName.toLowerCase()}</h3>
                                </div>
                                <div class="mcp-configured-server-actions">
                                    <button class="mcp-configured-action-btn" data-action="edit" data-server="${
                                      server.name
                                    }">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/>
                                            <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>
                                        </svg>
                                        Edit
                                    </button>
                                    <button class="mcp-configured-action-btn delete" data-action="delete" data-server="${
                                      server.name
                                    }">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                            <polyline points="3 6 5 6 21 6"/>
                                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                                        </svg>
                                        Delete
                                    </button>
                                </div>
                            </div>
                            <div class="mcp-connection-type">${server.type.toUpperCase()}</div>
                            <div class="mcp-configured-server-details">
                                <div class="mcp-configured-server-detail">
                                    <span class="mcp-configured-server-label">Command:</span>
                                    <span class="mcp-configured-server-value">${
                                      server.command
                                    }</span>
                                </div>
                                ${
                                  args
                                    ? `
                                    <div class="mcp-configured-server-detail">
                                        <span class="mcp-configured-server-label">Args:</span>
                                        <span class="mcp-configured-server-value">${args}</span>
                                    </div>
                                `
                                    : ""
                                }
                                ${
                                  server.env &&
                                  Object.keys(server.env).length > 0
                                    ? `
                                    <div class="mcp-configured-server-detail">
                                        <span class="mcp-configured-server-label">Environment:</span>
                                        <span class="mcp-configured-server-value">${
                                          Object.keys(server.env).length
                                        } variables</span>
                                    </div>
                                `
                                    : ""
                                }
                            </div>
                        </div>
                    `;
                  })
                  .join("")}
            </div>
        `;

    configuredServers.onclick = (e) => {
      const btn = e.target.closest(".mcp-configured-action-btn");
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const action = btn.getAttribute("data-action");
      const serverName = btn.getAttribute("data-server");

      console.log(
        "Button clicked via delegation - Action:",
        action,
        "Server:",
        serverName
      );

      if (action === "delete") {
        handleDeleteServer(serverName);
      } else if (action === "edit") {
        handleEditServer(serverName);
      } else {
        console.warn("Unknown action:", action);
      }
    };
  } else {
    configuredStatus.textContent = "0 configured";
    configuredStatus.classList.remove("configured");
    configuredServers.innerHTML =
      '<div class="mcp-no-servers">No MCP servers configured</div>';
  }

  renderPopularServers(data.tools, data.configuredServers || [], data.installing);
  mcpModal.classList.add("visible");
}

function handleCustomServerResult(data) {
  setSubmitButtonState(false);

  if (data.success) {
    hideCustomServerForm();
    showMCPModal();
  } else {
    showFormError(
      data.error || "Failed to add MCP server. Please check your configuration."
    );
  }
}

function handleDeleteServer(serverName) {
  console.log("handleDeleteServer() called with:", serverName);
  console.log("Sending delete request for server:", serverName);

  vscode.postMessage({
    type: "deleteMCPServer",
    serverName: serverName,
  });
}

function handleEditServer(serverName) {
  console.log("Edit server:", serverName);
  vscode.postMessage({
    type: "editMCPServer",
    serverName: serverName,
  });
}

// === Message Functions ===

function showHelpMessage() {
  // Add user message
  addMessage("user", "Show all available commands");
  
  // Create help content with all available commands
  const helpContent = `
<div style="font-family: var(--vscode-font-family); line-height: 1.6;">
  <h3 style="color: var(--theme-brand-primary); margin-bottom: 16px;">📚 Available Commands</h3>
  <p style="margin-bottom: 16px; color: var(--vscode-descriptionForeground);">
    Here are all the built-in slash commands you can use:
  </p>
  
  <div style="display: flex; flex-direction: column; gap: 12px;">
    ${slashCommandsData.map(cmd => `
      <div style="background: var(--vscode-input-background); padding: 12px; border-radius: 8px; border-left: 3px solid var(--theme-brand-primary);">
        <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
          <span style="font-size: 16px;">${cmd.icon}</span>
          <strong style="color: var(--theme-brand-primary); font-family: var(--vscode-editor-font-family);">${cmd.command}</strong>
        </div>
        <div style="color: var(--vscode-descriptionForeground); font-size: 13px; margin-left: 24px;">
          ${cmd.description}
        </div>
      </div>
    `).join('')}
  </div>
  
  <div style="margin-top: 20px; padding: 12px; background: rgba(255, 107, 53, 0.1); border-radius: 8px; border: 1px solid rgba(255, 107, 53, 0.3);">
    <p style="margin: 0; font-size: 13px; color: var(--vscode-foreground);">
      <strong>💡 Tip:</strong> Type <code>/</code> followed by any command name to use it, or just type <code>/</code> to see the dropdown menu.
    </p>
  </div>
</div>
  `.trim();
  
  // Add assistant response with help content
  addMessage("assistant", helpContent);
}

function sendMessage() {
  const message = messageInput.value.trim();
  if (!message || isWaiting) return;

  // Handle /help command locally (it comes as "Show all available commands")
  if (message === "Show all available commands") {
    showHelpMessage();
    messageInput.value = "";
    autoResize();
    updateInputTokenCount();
    return;
  }

  const inputTokens = estimateTokens(message);
  updateTotalTokenCount(inputTokens);

  isWaiting = true;
  isManuallyStopped = false; // Reset stop flag for new message
  showTypingIndicator();

  vscode.postMessage({
    type: "sendMessage",
    message: message,
  });

  messageInput.value = "";
  autoResize();
  updateInputTokenCount();
}

function stopGeneration() {
  isGenerating = false;
  isWaiting = false;
  isManuallyStopped = true;
  updateSendButtonState();
  hideTypingIndicator();

  vscode.postMessage({
    type: "stopGeneration"
  });
}

function updateSendButtonState() {
  const sendIcon = sendButton.querySelector('.send-icon');
  const stopIcon = sendButton.querySelector('.stop-icon');
  
  if (isGenerating) {
    sendButton.classList.add('stop-mode');
    sendButton.disabled = false;
    sendIcon.style.display = 'none';
    stopIcon.style.display = 'block';
    sendButton.title = 'Stop generation';
  } else {
    sendButton.classList.remove('stop-mode');
    sendButton.disabled = false;
    sendIcon.style.display = 'block';
    stopIcon.style.display = 'none';
    sendButton.title = 'Send message';
  }
}

function showTypingIndicator() {
  // isGenerating state is now managed by backend messages
  // to ensure it's set as soon as thinking starts
  
  const typingHtml = `
        <div class="typing-indicator">
            <div class="message-avatar" style="background: var(--claude-gradient); color: white;">C</div>
            <span style="color: var(--vscode-descriptionForeground);">Claude is thinking</span>
            <div class="typing-dots">
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
                <div class="typing-dot"></div>
            </div>
        </div>
    `;

  const emptyState = messagesContainer.querySelector(".empty-state");
  if (emptyState) {
    emptyState.style.display = "none";
  }

  messagesContainer.insertAdjacentHTML("beforeend", typingHtml);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideTypingIndicator() {
  const typingIndicator = messagesContainer.querySelector(".typing-indicator");
  if (typingIndicator) {
    typingIndicator.remove();
  }
  
  isGenerating = false;
  updateSendButtonState();
}

function renderMessages(messages) {
  hideTypingIndicator();
  resetTokenCounts();

  if (messages.length === 0) {
    messagesContainer.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-logo">C</div>
                <h2>Claude Dev Assistant</h2>
                <p>Your AI-powered coding companion</p>
                <p>I can explore your codebase, explain complex logic, implement features, and help debug issues.</p>
                
                <ul class="feature-list">
                    <li><div class="feature-icon">📁</div> Explore project structure</li>
                    <li><div class="feature-icon">🔍</div> Analyze and explain code</li>
                    <li><div class="feature-icon">✨</div> Generate new features</li>
                    <li><div class="feature-icon">🐛</div> Debug and fix issues</li>
                </ul>
            </div>
        `;
    return;
  }

  const emptyState = messagesContainer.querySelector(".empty-state");
  if (emptyState) {
    emptyState.style.display = "none";
  }

  messagesContainer.innerHTML = messages
    .map((msg) => {
      const time = new Date(msg.timestamp).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      const content = formatMessageContent(msg.content);
      const isUser = msg.role === "user";
      const avatar = isUser ? "You" : "C";
      const sender = isUser ? "You" : "Claude";

      const messageTokens = estimateTokens(msg.content);
      updateTotalTokenCount(messageTokens);

      const isThinking = !isUser && msg.content.trim() === "✱ Thinking...";
      const thinkingClass = isThinking ? " thinking-message" : "";

      return `
            <div class="message ${msg.role}" data-message-id="${msg.id}">
                <div class="message-header">
                    <div class="message-avatar">${avatar}</div>
                    <span>${sender}</span>
                    <span>•</span>
                    <span>${time}</span>
                </div>
                <div class="message-content-wrapper">
                    <div class="message-content${thinkingClass}">${content}</div>
                    ${!isThinking ? `<button class="message-copy-btn" onclick="copyMessage('${msg.id}')" title="Copy message">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                    </button>` : ''}
                </div>
            </div>
        `;
    })
    .join("");

  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatMessageContent(content) {
  if (
    content.includes("Using TodoWrite") ||
    (content.includes("todos") &&
      content.includes('"id"') &&
      content.includes('"status"'))
  ) {
    return formatTodoList(content);
  }

  // Process content in steps to avoid conflicts

  // First convert line breaks to proper newlines for regex processing
  let formatted = content.replace(/\\n/g, "\n");

  // Handle code blocks first to protect them from file path processing
  formatted = formatted.replace(
    /\`\`\`([\\s\\S]*?)\`\`\`/g,
    "<pre><code>$1</code></pre>"
  );

  // Handle inline code
  formatted = formatted.replace(/\`([^\`]+)\`/g, "<code>$1</code>");

  // Format tool usage lines with clickable file paths
  formatted = formatted.replace(
    /● ([^(\n]+)\(([^)\n]*)\)/g,
    (match, toolName, params) => {
      // Simple check if params looks like a file path (contains / or \ and has extension)
      if (
        (params.includes("/") || params.includes("\\")) &&
        /\.[a-zA-Z0-9]+$/.test(params.trim())
      ) {
        return `<div class="tool-usage">${toolName}(<span class="clickable-file-path" onclick="openFile('${params.trim()}')">${params}</span>)</div>`;
      }
      return `<div class="tool-usage">${toolName}(${params})</div>`;
    }
  );

  // Now handle standalone file paths - but skip any that are already inside tool-usage divs
  const toolUsageRegex = /<div class="tool-usage">.*?<\/div>/gs;
  const parts = formatted.split(toolUsageRegex);
  const toolUsageParts = formatted.match(toolUsageRegex) || [];

  // Process only the non-tool-usage parts for standalone file paths
  for (let i = 0; i < parts.length; i++) {
    parts[i] = parts[i].replace(
      /([\/\\](?:[^\/\\<>:"|?*\s\n]+[\/\\])*[^\/\\<>:"|?*\s\n]+\.[a-zA-Z0-9]+)/g,
      '<span class="clickable-file-path" onclick="openFile(\'$1\')">$1</span>'
    );
  }

  // Reconstruct the formatted content
  formatted = "";
  for (let i = 0; i < parts.length; i++) {
    formatted += parts[i];
    if (i < toolUsageParts.length) {
      formatted += toolUsageParts[i];
    }
  }

  // Continue with other formatting
  formatted = formatted
    // Bold text
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    // Italic text
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    // Clean up multiple consecutive line breaks
    .replace(/\n{3,}/g, "\n\n")
    // Convert remaining newlines to breaks
    .replace(/\n/g, "<br>");

  return formatted;
}

function formatTodoList(content) {
  try {
    const jsonMatch = content.match(/\\{[\\s\\S]*"todos"[\\s\\S]*\\}/);
    if (!jsonMatch) return content;

    const todoData = JSON.parse(jsonMatch[0]);
    if (!todoData.todos || !Array.isArray(todoData.todos)) return content;

    const todos = todoData.todos;
    const totalTodos = todos.length;
    const completedTodos = todos.filter(
      (todo) => todo.status === "completed"
    ).length;
    const inProgressTodos = todos.filter(
      (todo) => todo.status === "in_progress"
    ).length;
    const pendingTodos = todos.filter(
      (todo) => todo.status === "pending"
    ).length;

    return `
            <div class="todo-container">
                <div class="todo-header">
                    <div class="todo-title">📋 Tasks</div>
                    <div class="todo-stats">${completedTodos}/${totalTodos} completed • ${inProgressTodos} in progress • ${pendingTodos} pending</div>
                </div>
                <div class="todo-list">
                    ${todos
                      .map(
                        (todo) => `
                        <div class="todo-item ${todo.status}">
                            <div class="todo-content">
                                <div class="todo-text">${todo.content}</div>
                                <div class="todo-meta">
                                    <span class="todo-priority ${
                                      todo.priority
                                    }">${todo.priority}</span> • 
                                    <span class="todo-status">${todo.status.replace(
                                      "_",
                                      " "
                                    )}</span>
                                </div>
                            </div>
                        </div>
                    `
                      )
                      .join("")}
                </div>
                <div class="todo-progress">${Math.round(
                  (completedTodos / totalTodos) * 100
                )}% complete</div>
            </div>
        `;
  } catch (error) {
    console.error("Error formatting todo list:", error);
    return content;
  }
}

function updateStreamingMessage(messageId, content, isComplete) {
  // If manually stopped, ignore streaming updates
  if (isManuallyStopped) {
    return;
  }
  
  // Ensure we're in generation state when streaming starts
  if (!isComplete && !isGenerating) {
    isGenerating = true;
    updateSendButtonState();
  }
  
  const existingMessage = messagesContainer.querySelector(
    `[data-message-id="${messageId}"]`
  );

  if (existingMessage) {
    const contentElement = existingMessage.querySelector(".message-content");
    const copyBtn = existingMessage.querySelector(".message-copy-btn");
    if (contentElement) {
      const formattedContent = formatMessageContent(content);

      const isThinking = content.trim() === "✱ Thinking...";

      if (isThinking && !isComplete) {
        contentElement.className = "message-content thinking-message";
        contentElement.innerHTML = formattedContent;
        // Hide copy button during thinking
        if (copyBtn) copyBtn.style.display = "none";
      } else {
        contentElement.className = "message-content";
        contentElement.innerHTML =
          formattedContent +
          (isComplete ? "" : '<span class="streaming-cursor">|</span>');
        // Show copy button when not thinking - if it doesn't exist, create it
        if (copyBtn) {
          copyBtn.style.display = "block";
        } else {
          // Add copy button if it doesn't exist (transition from thinking to content)
          const wrapper = existingMessage.querySelector(".message-content-wrapper");
          if (wrapper) {
            const copyButton = document.createElement("button");
            copyButton.className = "message-copy-btn";
            copyButton.onclick = () => copyMessage(messageId);
            copyButton.title = "Copy message";
            copyButton.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
              </svg>
            `;
            wrapper.appendChild(copyButton);
          }
        }
      }
    }
  } else {
    const time = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
    const formattedContent = formatMessageContent(content);
    const isThinking = content.trim() === "✱ Thinking...";

    const messageHtml = `
            <div class="message assistant" data-message-id="${messageId}">
                <div class="message-header">
                    <div class="message-avatar">C</div>
                    <span>Claude</span>
                    <span>•</span>
                    <span>${time}</span>
                </div>
                <div class="message-content-wrapper">
                    <div class="message-content">${formattedContent}${
      isComplete ? "" : '<span class="streaming-cursor">|</span>'
    }</div>
                    ${!isThinking ? `<button class="message-copy-btn" onclick="copyMessage('${messageId}')" title="Copy message">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
                        </svg>
                    </button>` : ''}
                </div>
            </div>
        `;

    messagesContainer.insertAdjacentHTML("beforeend", messageHtml);
  }

  messagesContainer.scrollTop = messagesContainer.scrollHeight;

  if (isComplete) {
    const cursor = messagesContainer.querySelector(
      `[data-message-id="${messageId}"] .streaming-cursor`
    );
    if (cursor) {
      cursor.remove();
    }

    if (content && content.trim() !== "✱ Thinking...") {
      const responseTokens = estimateTokens(content);
      updateTotalTokenCount(responseTokens);
    }
  }
}

function autoResize() {
  messageInput.style.height = "auto";
  const newHeight = Math.min(messageInput.scrollHeight, 100);
  messageInput.style.height = newHeight + "px";
}

// === Token Management ===

let totalTokensUsed = 0;
const inputTokensElement = document.getElementById("inputTokens");
const totalTokensElement = document.getElementById("totalTokens");

function estimateTokens(text) {
  if (!text) return 0;
  const cleanText = text.trim();
  if (cleanText.length === 0) return 0;

  const words = cleanText.split(/\\s+/).length;
  const characters = cleanText.length;

  return Math.max(1, Math.ceil(characters / 4 + words * 0.1));
}

function updateInputTokenCount() {
  const text = messageInput.value;
  const tokenCount = estimateTokens(text);
  if (inputTokensElement) {
    inputTokensElement.textContent = tokenCount.toString();

    const tokenCounter = inputTokensElement.closest(".token-counter");
    if (tokenCounter) {
      tokenCounter.classList.toggle("updating", tokenCount > 0);

      // Add visual feedback for long messages
      inputTokensElement.classList.remove("warning", "error");
      if (tokenCount > 2000) {
        inputTokensElement.classList.add("error");
      } else if (tokenCount > 1000) {
        inputTokensElement.classList.add("warning");
      }
    }
  }
}

function updateTotalTokenCount(additionalTokens = 0) {
  totalTokensUsed += additionalTokens;
  if (totalTokensElement) {
    let displayText;
    if (totalTokensUsed >= 1000) {
      displayText = (totalTokensUsed / 1000).toFixed(1) + "k";
    } else {
      displayText = totalTokensUsed.toString();
    }
    totalTokensElement.textContent = displayText;

    // Update token counter styling based on usage
    const tokenCounter = totalTokensElement.closest(".token-counter");
    if (tokenCounter) {
      tokenCounter.classList.remove("has-warning", "has-error");
      totalTokensElement.classList.remove("warning", "error");

      if (totalTokensUsed > 10000) {
        tokenCounter.classList.add("has-error");
        totalTokensElement.classList.add("error");
      } else if (totalTokensUsed > 5000) {
        tokenCounter.classList.add("has-warning");
        totalTokensElement.classList.add("warning");
      }
    }
  }

  const estimatedCost = (totalTokensUsed * 0.003) / 1000;
  vscode.postMessage({
    type: "updateConversationMetrics",
    tokens: totalTokensUsed,
    cost: estimatedCost,
  });
}

function resetTokenCounts() {
  totalTokensUsed = 0;
  updateTotalTokenCount(0);
  updateInputTokenCount();
}

// === Slash Commands ===

const slashCommandsDropdown = document.getElementById("slashCommandsDropdown");
let selectedIndex = -1;
let slashCommands = [];
let isShowingSlashCommands = false;

const slashCommandsData = [
  {
    command: "/bug",
    icon: "🐛",
    description: "Debug issues and identify solutions",
  },
  {
    command: "/review",
    icon: "👀",
    description: "Code review for quality and best practices",
  },
  {
    command: "/explain",
    icon: "📖",
    description: "Detailed code explanations",
  },
  {
    command: "/optimize",
    icon: "⚡",
    description: "Performance optimization suggestions",
  },
  { command: "/refactor", icon: "🔄", description: "Code refactoring advice" },
  { command: "/test", icon: "🧪", description: "Help writing tests" },
  { command: "/docs", icon: "📝", description: "Generate documentation" },
  {
    command: "/security",
    icon: "🔒",
    description: "Security vulnerability analysis",
  },
  { command: "/fix", icon: "🔧", description: "Fix errors and issues" },
  { command: "/implement", icon: "⚙️", description: "Implementation guidance" },
  { command: "/design", icon: "🎨", description: "Architecture design help" },
  { command: "/api", icon: "🌐", description: "API design and implementation" },
  {
    command: "/database",
    icon: "🗄️",
    description: "Database schema and queries",
  },
  { command: "/deploy", icon: "🚀", description: "Deployment strategies" },
  { command: "/performance", icon: "📊", description: "Performance analysis" },
  { command: "/structure", icon: "🏗️", description: "Code organization" },
  {
    command: "/patterns",
    icon: "🎯",
    description: "Design pattern suggestions",
  },
  { command: "/migrate", icon: "📦", description: "Technology migration help" },
  {
    command: "/compare",
    icon: "⚖️",
    description: "Compare approaches/technologies",
  },
  { command: "/help", icon: "❓", description: "Show all available commands" },
];

function showSlashCommands(filter = "") {
  slashCommands = slashCommandsData.filter((cmd) =>
    cmd.command.toLowerCase().includes(filter.toLowerCase())
  );

  if (slashCommands.length === 0) {
    hideSlashCommands();
    return;
  }

  const html = slashCommands
    .map(
      (cmd, index) =>
        '<div class="slash-command-item" data-index="' +
        index +
        '" data-command="' +
        cmd.command +
        '">' +
        '<div class="slash-command-icon">' +
        cmd.icon +
        "</div>" +
        '<div class="slash-command-content">' +
        '<div class="slash-command-title">' +
        cmd.command +
        "</div>" +
        '<div class="slash-command-description">' +
        cmd.description +
        "</div>" +
        "</div>" +
        "</div>"
    )
    .join("");

  slashCommandsDropdown.innerHTML = html;
  slashCommandsDropdown.classList.add("visible");
  isShowingSlashCommands = true;
  selectedIndex = -1;

  slashCommandsDropdown
    .querySelectorAll(".slash-command-item")
    .forEach((item) => {
      item.addEventListener("click", () => {
        const command = item.getAttribute("data-command");
        selectSlashCommand(command);
      });
    });
}

function hideSlashCommands() {
  slashCommandsDropdown.classList.remove("visible");
  isShowingSlashCommands = false;
  selectedIndex = -1;
}

function selectSlashCommand(command) {
  const value = messageInput.value;
  const cursorPos = messageInput.selectionStart;
  const beforeCursor = value.substring(0, cursorPos);
  const afterCursor = value.substring(cursorPos);

  const slashIndex = beforeCursor.lastIndexOf("/");
  if (slashIndex !== -1) {
    // Find the command data to get its description
    const commandData = slashCommandsData.find(
      (cmd) => cmd.command === command
    );
    const description = commandData ? commandData.description : "";

    const newValue = value.substring(0, slashIndex) + description + afterCursor;
    messageInput.value = newValue;
    const newCursorPos = slashIndex + description.length;
    messageInput.setSelectionRange(newCursorPos, newCursorPos);
  }

  hideSlashCommands();
  messageInput.focus();
  autoResize();
}

function updateSelectedItem() {
  slashCommandsDropdown
    .querySelectorAll(".slash-command-item")
    .forEach((item, index) => {
      item.classList.toggle("selected", index === selectedIndex);
    });
}

// === History Modal ===

const historyButton = document.getElementById("historyButton");
const historyModalOverlay = document.getElementById("historyModalOverlay");
const historyCloseBtn = document.getElementById("historyCloseBtn");
const historyConversationList = document.getElementById(
  "historyConversationList"
);
const historySearchInput = document.getElementById("historySearchInput");

// Store all conversations for filtering
let allConversations = [];

function showHistoryModal() {
  historyModalOverlay.classList.add("visible");
  loadConversationHistory();
}

function hideHistoryModal() {
  historyModalOverlay.classList.remove("visible");
}

function loadConversationHistory() {
  historyConversationList.innerHTML =
    '<div class="history-loading">Loading conversations...</div>';
  vscode.postMessage({
    type: "requestConversationHistory",
  });
}

function renderConversationHistory(conversations) {
  // Store all conversations for filtering
  allConversations = conversations;

  // Clear search input when new data arrives
  historySearchInput.value = "";

  renderFilteredConversations(conversations);
}

function renderFilteredConversations(conversations) {
  if (conversations.length === 0) {
    if (allConversations.length === 0) {
      historyConversationList.innerHTML =
        '<div class="history-loading">No conversation history found.</div>';
    } else {
      historyConversationList.innerHTML =
        '<div class="history-loading">No conversations match your search.</div>';
    }
    return;
  }

  const conversationItems = conversations
    .map((conversation) => {
      const date = new Date(conversation.lastActivity);
      const dateStr =
        date.toLocaleDateString() + " at " + date.toLocaleTimeString();
      const messageCount = conversation.messageCount || 0;

      let estimatedCost = "0.000";
      if (conversation.estimatedCost) {
        estimatedCost = conversation.estimatedCost.toFixed(3);
      } else if (conversation.totalTokens) {
        estimatedCost = ((conversation.totalTokens * 0.003) / 1000).toFixed(3);
      }

      const lastMessage = conversation.lastMessage || "No messages";
      const truncatedLast =
        lastMessage.length > 50
          ? lastMessage.substring(0, 50) + "..."
          : lastMessage;

      return (
        '<div class="history-conversation-item" data-conversation-id="' +
        conversation.id +
        '">' +
        '<div class="history-conversation-content" onclick="selectConversation(\'' +
        conversation.id +
        "')\">" +
        '<div class="history-conversation-title">' +
        conversation.title +
        "</div>" +
        '<div class="history-conversation-meta">' +
        "<span>" +
        dateStr +
        "</span>" +
        "<span>•</span>" +
        "<span>" +
        messageCount +
        " messages</span>" +
        "<span>•</span>" +
        '<span class="history-conversation-cost">$' +
        estimatedCost +
        "</span>" +
        "</div>" +
        '<div class="history-conversation-last">Last: ' +
        truncatedLast +
        "</div>" +
        "</div>" +
        '<button class="history-delete-btn" onclick="deleteConversation(\'' +
        conversation.id +
        '\', event)" title="Delete conversation">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">' +
        '<path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>' +
        "</svg>" +
        "</button>" +
        "</div>"
      );
    })
    .join("");

  historyConversationList.innerHTML = conversationItems;
}

function filterConversations(searchTerm) {
  if (!searchTerm.trim()) {
    renderFilteredConversations(allConversations);
    return;
  }

  const filtered = allConversations.filter((conversation) => {
    return (
      conversation.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (conversation.lastMessage &&
        conversation.lastMessage
          .toLowerCase()
          .includes(searchTerm.toLowerCase()))
    );
  });

  renderFilteredConversations(filtered);
}

function selectConversation(conversationId) {
  hideHistoryModal();
  vscode.postMessage({
    type: "loadConversation",
    conversationId: conversationId,
  });
}

function deleteConversation(conversationId, event) {
  console.log("deleteConversation called with:", conversationId);
  event.stopPropagation(); // Prevent triggering selectConversation

  // Find and update the conversation item UI
  const conversationItem = document.querySelector(
    `[data-conversation-id="${conversationId}"]`
  );
  console.log("Found conversation item:", conversationItem);
  if (conversationItem) {
    conversationItem.style.opacity = "0.5";
    conversationItem.style.pointerEvents = "none";

    // Add loading indicator to delete button
    const deleteBtn = conversationItem.querySelector(".history-delete-btn");
    if (deleteBtn) {
      deleteBtn.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="spinner"><circle cx="12" cy="12" r="2"/></svg>';
      deleteBtn.style.animation = "spin 1s linear infinite";
    }
  }

  // Send delete request to backend
  vscode.postMessage({
    type: "deleteConversation",
    conversationId: conversationId,
  });
}

function handleDeleteConversationResult(data) {
  console.log("Received deleteConversationResult:", data);
  const { conversationId, success, error } = data;
  const conversationItem = document.querySelector(
    `[data-conversation-id="${conversationId}"]`
  );

  if (success) {
    // Remove the conversation item with animation
    if (conversationItem) {
      conversationItem.style.transform = "translateX(-100%)";
      conversationItem.style.opacity = "0";
      setTimeout(() => {
        conversationItem.remove();
        // Check if history is empty now
        const remainingItems = document.querySelectorAll(
          ".history-conversation-item"
        );
        if (remainingItems.length === 0) {
          historyConversationList.innerHTML =
            '<div class="history-loading">No conversation history found.</div>';
        }
      }, 300);
    }
  } else {
    // Restore the conversation item and show error
    if (conversationItem) {
      conversationItem.style.opacity = "1";
      conversationItem.style.pointerEvents = "";

      // Restore delete button
      const deleteBtn = conversationItem.querySelector(".history-delete-btn");
      if (deleteBtn) {
        deleteBtn.innerHTML =
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>';
        deleteBtn.style.animation = "";
      }
    }

    console.error("Failed to delete conversation:", error || "Unknown error");
  }
}

function handleClearAllHistoryResult(data) {
  console.log("Received clearAllHistoryResult:", data);
  const { success, error } = data;

  if (success) {
    // Clear all conversations from UI
    allConversations = [];
    historySearchInput.value = "";
    historyConversationList.innerHTML =
      '<div class="history-loading">No conversation history found.</div>';
  } else {
    console.error(
      "Failed to clear all conversations:",
      error || "Unknown error"
    );
    // You could show an error message to the user here if needed
  }
}

// Open file functionality
function openFile(filePath) {
  console.log("Opening file:", filePath);
  vscode.postMessage({
    type: "openFile",
    filePath: filePath,
  });
}

// Configure model functionality
function configureModel(event) {
  event.stopPropagation(); // Prevent model selection
  
  // Send message to backend to run "claude /model" command
  vscode.postMessage({
    type: "runCommand",
    command: "claude /model"
  });
  
  hideModelDropdown();
}

// Copy message functionality
function copyMessage(messageId) {
  const messageElement = document.querySelector(
    `[data-message-id="${messageId}"]`
  );
  if (!messageElement) {
    console.error("Message element not found:", messageId);
    return;
  }

  const contentElement = messageElement.querySelector(".message-content");
  if (!contentElement) {
    console.error("Message content not found:", messageId);
    return;
  }

  // Get the text content, removing HTML tags but preserving line breaks
  let textContent = contentElement.innerHTML
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();

  // Copy to clipboard
  navigator.clipboard
    .writeText(textContent)
    .then(() => {
      // Visual feedback
      const copyBtn = messageElement.querySelector(".message-copy-btn");
      const originalTitle = copyBtn.title;
      const originalSvg = copyBtn.innerHTML;

      // Show checkmark icon
      copyBtn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17z"/>
            </svg>
        `;
      copyBtn.title = "Copied!";
      copyBtn.classList.add("copied");

      // Reset after 2 seconds
      setTimeout(() => {
        copyBtn.innerHTML = originalSvg;
        copyBtn.title = originalTitle;
        copyBtn.classList.remove("copied");
      }, 2000);
    })
    .catch((err) => {
      console.error("Failed to copy message:", err);

      // Fallback for older browsers
      const textArea = document.createElement("textarea");
      textArea.value = textContent;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand("copy");
      document.body.removeChild(textArea);

      // Still show visual feedback
      const copyBtn = messageElement.querySelector(".message-copy-btn");
      copyBtn.classList.add("copied");
      setTimeout(() => copyBtn.classList.remove("copied"), 2000);
    });
}

// === Settings ===

function syncUISettings(settings) {
  if (settings.model) {
    currentSelectedModel = settings.model;
    const modelDisplayNames = {
      default: "Default",
      sonnet: "Sonnet",
      opus: "Opus",
    };
    document.getElementById("currentModelText").textContent =
      modelDisplayNames[settings.model] || settings.model;
  }
  if (settings.thinkingMode) {
    document.getElementById("thinkingSelect").value = settings.thinkingMode;
  }
}

// === Event Listeners ===

// New Chat Button
document.getElementById("newChatButton").addEventListener("click", () => {
  vscode.postMessage({ type: "clearChat" });
});

// MCP Modal
mcpServerBtn.addEventListener("click", showMCPModal);
mcpCloseBtn.addEventListener("click", hideMCPModal);
mcpModal.addEventListener("click", (e) => {
  if (e.target === mcpModal) {
    hideMCPModal();
  }
});

// Custom Server Form
addServerBtn.addEventListener("click", showCustomServerForm);
customServerCloseBtn.addEventListener("click", cancelCustomServerForm);
cancelCustomServer.addEventListener("click", cancelCustomServerForm);
advancedToggle.addEventListener("click", toggleAdvancedConfig);
customServerForm.addEventListener("submit", handleCustomServerSubmit);

customServerModal.addEventListener("click", (e) => {
  if (e.target === customServerModal) {
    cancelCustomServerForm();
  }
});

document.getElementById("serverName").addEventListener("input", hideFormError);
document
  .getElementById("serverCommand")
  .addEventListener("input", hideFormError);

// Message Input
messageInput.addEventListener("input", () => {
  autoResize();
  updateInputTokenCount();

  const value = messageInput.value;
  const cursorPos = messageInput.selectionStart;
  const beforeCursor = value.substring(0, cursorPos);

  const slashIndex = beforeCursor.lastIndexOf("/");
  const spaceIndex = beforeCursor.lastIndexOf(" ");

  if (slashIndex > spaceIndex && slashIndex !== -1) {
    const commandPart = beforeCursor.substring(slashIndex);
    if (commandPart.length > 1) {
      showSlashCommands(commandPart);
    } else if (commandPart === "/") {
      showSlashCommands();
    }
  } else {
    hideSlashCommands();
  }
});

messageInput.addEventListener("keydown", (e) => {
  if (isShowingSlashCommands) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, slashCommands.length - 1);
      updateSelectedItem();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, -1);
      updateSelectedItem();
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < slashCommands.length) {
        // User has navigated and selected a specific command
        selectSlashCommand(slashCommands[selectedIndex].command);
      } else if (slashCommands.length === 1) {
        // Only one command available, auto-select it
        selectSlashCommand(slashCommands[0].command);
      }
      return;
    } else if (e.key === "Escape") {
      e.preventDefault();
      hideSlashCommands();
      return;
    }
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    hideSlashCommands();
    if (!isGenerating) {
      sendMessage();
    }
  }
});

// ESC key to cancel generation
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && isGenerating) {
    e.preventDefault();
    stopGeneration();
  }
});

document.addEventListener("click", (e) => {
  if (
    !messageInput.contains(e.target) &&
    !slashCommandsDropdown.contains(e.target)
  ) {
    hideSlashCommands();
  }
});

// History Modal
historyButton.addEventListener("click", showHistoryModal);
historyCloseBtn.addEventListener("click", hideHistoryModal);
document.getElementById("clearAllHistoryBtn").addEventListener("click", () => {
  vscode.postMessage({ type: "clearAllHistory" });
});
historySearchInput.addEventListener("input", (e) => {
  filterConversations(e.target.value);
});
historyModalOverlay.addEventListener("click", (e) => {
  if (e.target === historyModalOverlay) {
    hideHistoryModal();
  }
});

// Send Button
sendButton.addEventListener("click", () => {
  if (isGenerating) {
    stopGeneration();
  } else {
    sendMessage();
  }
});

// Model Controls
let currentSelectedModel = "default";

document.getElementById("modelSelectButton").addEventListener("click", (e) => {
  e.stopPropagation();
  toggleModelDropdown();
});

function showModelDropdown() {
  const modelDropdown = document.getElementById("modelDropdown");
  modelDropdown.classList.add("visible");
  updateModelDropdownState();
}

function hideModelDropdown() {
  const modelDropdown = document.getElementById("modelDropdown");
  modelDropdown.classList.remove("visible");
}

function toggleModelDropdown() {
  const modelDropdown = document.getElementById("modelDropdown");
  if (modelDropdown.classList.contains("visible")) {
    hideModelDropdown();
  } else {
    showModelDropdown();
  }
}

function updateModelDropdownState() {
  // Update selected state
  document.querySelectorAll(".model-option").forEach((option) => {
    option.classList.remove("selected");
    // Hide all checkmarks
    const statusEl = option.querySelector(".model-status");
    if (statusEl) {
      statusEl.style.display = "none";
    }
    // Show multipliers
    const multiplierEl = option.querySelector(".model-multiplier");
    if (multiplierEl) {
      multiplierEl.style.display = "inline-block";
    }
  });
  
  const currentOption = document.querySelector(`[data-model="${currentSelectedModel}"]`);
  if (currentOption) {
    currentOption.classList.add("selected");
    // Show checkmark for selected model
    const statusEl = currentOption.querySelector(".model-status");
    if (statusEl) {
      statusEl.style.display = "inline-block";
    }
    // Hide multiplier for selected model
    const multiplierEl = currentOption.querySelector(".model-multiplier");
    if (multiplierEl) {
      multiplierEl.style.display = "none";
    }
  }
}

function selectModel(modelName) {
  currentSelectedModel = modelName;

  // Update UI
  const modelDisplayNames = {
    default: "Default",
    sonnet: "Sonnet",
    opus: "Opus",
  };

  document.getElementById("currentModelText").textContent =
    modelDisplayNames[modelName] || modelName;

  // Send update to backend
  vscode.postMessage({
    type: "updateConfig",
    key: "model",
    value: modelName,
  });

  hideModelDropdown();
}

// Dropdown event listeners
document.querySelectorAll(".model-option").forEach((option) => {
  option.addEventListener("click", (e) => {
    const modelName = e.currentTarget.getAttribute("data-model");
    selectModel(modelName);
  });
});

// Click outside to close dropdown
document.addEventListener("click", (e) => {
  const modelDropdown = document.getElementById("modelDropdown");
  const modelButton = document.getElementById("modelSelectButton");
  
  if (!modelDropdown.contains(e.target) && !modelButton.contains(e.target)) {
    hideModelDropdown();
  }
});

// ESC key support
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    const modelDropdown = document.getElementById("modelDropdown");
    if (modelDropdown.classList.contains("visible")) {
      hideModelDropdown();
    }
  }
});

document.getElementById("thinkingSelect").addEventListener("change", (e) => {
  vscode.postMessage({
    type: "updateConfig",
    key: "thinkingMode",
    value: e.target.value,
  });
});

// VSCode Message Handler
window.addEventListener("message", (event) => {
  const message = event.data;
  switch (message.type) {
    case "updateMessages":
      renderMessages(message.messages);
      isWaiting = false;
      isGenerating = false;
      updateSendButtonState();
      break;
    case "streamingUpdate":
      // Don't process streaming updates if manually stopped
      if (!isManuallyStopped) {
        updateStreamingMessage(
          message.messageId,
          message.content,
          message.isComplete
        );
        if (message.isComplete) {
          isWaiting = false;
          isGenerating = false;
          updateSendButtonState();
        }
      }
      break;
    case "showMCPModal":
      if (isInitialized) {
        updateMCPModal(message.data);
      }
      break;
    case "customServerResult":
      handleCustomServerResult(message.data);
      break;
    case "showEditMCPForm":
      showEditServerForm(message.serverData);
      break;
    case "syncSettings":
      syncUISettings(message.settings);
      break;
    case "resetTokens":
      resetTokenCounts();
      break;
    case "conversationHistory":
      renderConversationHistory(message.conversations);
      break;
    case "deleteConversationResult":
      handleDeleteConversationResult(message.data);
      break;
    case "clearAllHistoryResult":
      handleClearAllHistoryResult(message.data);
      break;
    case "generationStarted":
      isGenerating = true;
      updateSendButtonState();
      break;
    case "generationStopped":
      isGenerating = false;
      isWaiting = false;
      updateSendButtonState();
      hideTypingIndicator();
      break;
  }
});

// Initialize
autoResize();
updateInputTokenCount();

// Ensure all modals are hidden on initialization
hideMCPModal();
hideCustomServerForm();
hideHistoryModal();
hideModelDropdown();

vscode.postMessage({ type: "requestSettings" });
vscode.postMessage({ type: "requestConversation" });

// Mark as initialized after a short delay to ensure all initial messages are processed
setTimeout(() => {
  isInitialized = true;
}, 100);
