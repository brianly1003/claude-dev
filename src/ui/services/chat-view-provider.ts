import * as vscode from "vscode";
import {
  ClaudeCodeService,
  CompletionRequest,
  StreamingCompletionOptions,
} from "../../core/claude-code-service";
import { ConversationManager } from "../../core/conversation-manager";
import { UITestService } from "../../features/ui-testing/ui-test-service";
import { HtmlTemplateService } from "./html-template-service";

export class ChatViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "claudeDevChat";
  private _view?: vscode.WebviewView;
  private claudeCodeService: ClaudeCodeService;
  private conversationManager: ConversationManager;
  private uiTestService: UITestService;
  private htmlTemplateService: HtmlTemplateService;
  private streamingMessageId: string | null = null;
  private isGenerating: boolean = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    claudeCodeService: ClaudeCodeService,
    context: vscode.ExtensionContext
  ) {
    this.claudeCodeService = claudeCodeService;
    this.conversationManager = new ConversationManager(context);
    this.uiTestService = new UITestService(claudeCodeService);
    this.htmlTemplateService = new HtmlTemplateService(_extensionUri);
    this.loadMostRecentConversation();
  }

  private async loadMostRecentConversation(): Promise<void> {
    const recent = await this.conversationManager.loadMostRecentConversation();
    if (recent) {
      // Update webview if it's already initialized
      if (this._view) {
        await this.updateWebview();
      }
    }
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (data) => {
      console.log("Backend received message:", data.type, data);
      switch (data.type) {
        case "sendMessage":
          await this.handleUserMessage(data.message);
          break;
        case "clearChat":
          await this.clearChat();
          // Reset token counts in UI
          if (this._view) {
            this._view.webview.postMessage({
              type: "resetTokens",
            });
          }
          break;
        case "openMCPModal":
          this.sendMCPServerData();
          break;
        case "installMCPServer":
          await this.installMCPServer(data.serverName);
          break;
        case "addCustomMCPServer":
          await this.addCustomMCPServer(data.serverConfig);
          break;
        case "deleteMCPServer":
          console.log("Received deleteMCPServer message with data:", data);
          await this.deleteMCPServer(data.serverName);
          break;
        case "editMCPServer":
          await this.editMCPServer(data.serverName);
          break;
        case "updateMCPServer":
          await this.updateMCPServer(data.originalName, data.serverConfig);
          break;
        case "updateConfig":
          await this.updateVSCodeConfig(data.key, data.value);
          break;
        case "requestSettings":
          this.sendCurrentSettings();
          break;
        case "requestConversation":
          await this.updateWebview();
          break;
        case "requestConversationHistory":
          await this.sendConversationHistory();
          break;
        case "loadConversation":
          await this.loadSpecificConversation(data.conversationId);
          break;
        case "updateConversationMetrics":
          this.conversationManager.updateConversationMetrics(
            data.tokens,
            data.cost
          );
          break;
        case "deleteConversation":
          await this.deleteConversation(data.conversationId);
          break;
        case "clearAllHistory":
          await this.clearAllConversations();
          break;
        case "openFile":
          await this.openFile(data.filePath);
          break;
        case "runCommand":
          await this.runTerminalCommand(data.command);
          break;
        case "stopGeneration":
          await this.stopGeneration();
          break;
        case "enhancePrompt":
          await this.handleEnhancePrompt(data.text);
          break;
        default:
          console.log("Unhandled message type:", data.type, data);
          break;
      }
    });
  }

  private async handleUserMessage(message: string) {
    if (!message.trim()) {
      return;
    }

    // Process slash commands
    const processedMessage = this.processSlashCommand(message.trim());

    // Add user message to conversation and auto-save
    this.conversationManager.addMessage("user", message.trim());
    await this.updateWebview();

    // If processSlashCommand returned empty (like for /help), just update webview and return
    if (!processedMessage) {
      await this.updateWebview();
      return;
    }

    // Check if this is an MCP/UI testing request
    if (this.shouldRoutToMCPHandler(processedMessage)) {
      const mcpResponse = await this.uiTestService.handleUITestingChat(
        processedMessage
      );
      this.conversationManager.addMessage("assistant", mcpResponse);
      await this.updateWebview();
      return;
    }

    // Create a streaming assistant message placeholder with thinking indicator
    const thinkingMessage = "✱ Thinking...";
    const streamingMessage = this.conversationManager.addMessage(
      "assistant",
      thinkingMessage
    );
    this.streamingMessageId = streamingMessage.id;
    this.isGenerating = true;
    
    // Notify frontend that generation has started (thinking phase)
    if (this._view) {
      this._view.webview.postMessage({
        type: "generationStarted"
      });
    }
    
    await this.updateWebview();

    try {
      const context = this.buildContext();
      const completionRequest: CompletionRequest = {
        prompt: processedMessage,
        context: context,
        language: "text",
      };

      const streamingOptions: StreamingCompletionOptions = {
        onStreamingUpdate: (partialResponse: string, isComplete: boolean) => {
          this.handleStreamingUpdate(partialResponse, isComplete);
        },
      };

      const response = await this.claudeCodeService.getCompletion(
        completionRequest,
        streamingOptions
      );

      console.log("Chat response:", {
        suggestion: response.suggestion,
        error: response.error,
        hasSuggestion: !!response.suggestion,
        suggestionLength: response.suggestion?.length || 0,
      });

      const responseContent =
        response.suggestion && response.suggestion.trim()
          ? response.suggestion
          : response.error ||
            "Sorry, I couldn't process your request. Please check if Claude Code is properly configured.";

      // Update the streaming message with final content
      this.updateStreamingMessage(responseContent, true);
    } catch (error) {
      const errorContent = `Error: ${
        error instanceof Error ? error.message : "Unknown error occurred"
      }`;

      // Update the streaming message with error content
      this.updateStreamingMessage(errorContent, true);
    } finally {
      this.isGenerating = false;
    }
  }


  private async handleEnhancePrompt(text: string) {
    try {
      // Use Claude Code SDK to enhance the prompt with grammar correction
      const completionRequest: CompletionRequest = {
        prompt: `Please improve the following prompt by correcting any grammar, spelling, or punctuation errors. Make it clearer and more concise while preserving the original intent. Only return the improved prompt without any explanation or additional text:

"${text}"`,
        context: "",
        language: "text",
      };

      const response = await this.claudeCodeService.getCompletion(completionRequest);
      
      // Send the enhanced prompt back to the webview
      if (this._view) {
        this._view.webview.postMessage({
          type: "enhancedPrompt",
          enhancedText: response.suggestion.trim(),
          success: true
        });
      }
    } catch (error) {
      console.error("Error enhancing prompt:", error);
      // Send back the original text if enhancement fails
      if (this._view) {
        this._view.webview.postMessage({
          type: "enhancedPrompt",
          enhancedText: text,
          success: false
        });
      }
    }
  }

  private shouldRoutToMCPHandler(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    const mcpKeywords = ["mcp", "puppeteer", "playwright"];
    const testingKeywords = [
      "ui test",
      "test ui",
      "browser test",
      "create test",
    ];
    const projectKeywords = ["open the web project"];

    return (
      mcpKeywords.some((keyword) => lowerMessage.includes(keyword)) ||
      testingKeywords.some((keyword) => lowerMessage.includes(keyword)) ||
      projectKeywords.some((keyword) => lowerMessage.includes(keyword))
    );
  }

  private buildContext(): string {
    // Minimal context to prevent overflow
    const workspaceFolders = vscode.workspace.workspaceFolders;
    let context = "";

    if (workspaceFolders && workspaceFolders.length > 0) {
      context += `Workspace: ${workspaceFolders[0].name}\n`;
    }

    const activeEditor = vscode.window.activeTextEditor;
    if (!activeEditor) {
      return context + "No file open";
    }

    const document = activeEditor.document;
    const selection = activeEditor.selection;

    context += `File: ${document.fileName.split("/").pop()}\n`;

    if (!selection.isEmpty) {
      const selectedText = document.getText(selection);
      // Truncate selected text to prevent overflow
      context += `Selected: ${selectedText.substring(0, 200)}${
        selectedText.length > 200 ? "..." : ""
      }\n`;
    }

    // Minimal file context - only 8 lines
    const maxLines = 8;
    const totalLines = document.lineCount;
    const startLine = Math.max(
      0,
      Math.min(selection.start.line - 4, totalLines - maxLines)
    );
    const endLine = Math.min(totalLines, startLine + maxLines);

    for (let i = startLine; i < endLine; i++) {
      const line = document.lineAt(i).text;
      // Truncate long lines
      const truncatedLine =
        line.length > 80 ? line.substring(0, 80) + "..." : line;
      context += `${i + 1}: ${truncatedLine}\n`;
    }

    return context;
  }

  private handleStreamingUpdate(partialResponse: string, isComplete: boolean) {
    // Don't update if generation has been stopped
    if (!this.isGenerating) {
      return;
    }
    this.updateStreamingMessage(partialResponse, isComplete);
  }

  private updateStreamingMessage(content: string, isComplete: boolean) {
    if (!this.streamingMessageId || !this.isGenerating) return;

    const currentConversation =
      this.conversationManager.getCurrentConversation();
    if (!currentConversation) return;

    // Find and update the streaming message
    const messageIndex = currentConversation.messages.findIndex(
      (msg: any) => msg.id === this.streamingMessageId
    );
    if (messageIndex !== -1) {
      currentConversation.messages[messageIndex].content = content;
      currentConversation.metadata.lastActivity = Date.now();

      // Send real-time update to webview
      this.sendStreamingUpdate(this.streamingMessageId, content, isComplete);

      // Save to storage when complete
      if (isComplete) {
        this.conversationManager.getCurrentConversation(); // Trigger save
        this.streamingMessageId = null;
      }
    }
  }

  private sendStreamingUpdate(
    messageId: string,
    content: string,
    isComplete: boolean
  ) {
    if (this._view) {
      this._view.webview.postMessage({
        type: "streamingUpdate",
        messageId: messageId,
        content: content,
        isComplete: isComplete,
      });
    }
  }

  public async clearChat() {
    this.conversationManager.clearHistory();
    this.conversationManager.startNewConversation();
    await this.updateWebview();
  }

  private async updateWebview() {
    if (this._view) {
      let currentConversation =
        this.conversationManager.getCurrentConversation();

      // If no current conversation, try to load the most recent one
      if (!currentConversation) {
        currentConversation =
          await this.conversationManager.loadMostRecentConversation();
      }

      const messages = currentConversation ? currentConversation.messages : [];

      this._view.webview.postMessage({
        type: "updateMessages",
        messages: messages,
      });
    }
  }

  private sendMCPServerData() {
    if (this._view) {
      const mcpStatus = this.uiTestService.getMCPStatus();
      const detailedServers = this.uiTestService.getDetailedMCPServers();

      console.log(
        "ChatViewProvider.sendMCPServerData() - MCP Status:",
        mcpStatus
      );
      console.log(
        "ChatViewProvider.sendMCPServerData() - Detailed Servers:",
        detailedServers
      );

      this._view.webview.postMessage({
        type: "showMCPModal",
        data: {
          configured: mcpStatus.configured,
          tools: mcpStatus.tools,
          configuredServers: detailedServers,
          configPath: mcpStatus.configPath,
        },
      });
    }
  }

  private async installMCPServer(serverName: string) {
    try {
      // Install specific MCP server based on name
      await this.installSpecificMCPServer(serverName);

      // Send updated status back to UI
      this.sendMCPServerData();

      // Show success message in chat
      const successMessage = `✅ Successfully installed ${serverName} MCP server! ${this.getServerDescription(
        serverName
      )}`;
      this.conversationManager.addMessage("assistant", successMessage);
      this.updateWebview();
    } catch (error) {
      // Show error message in chat
      const errorMessage = `❌ Failed to install ${serverName}: ${
        error instanceof Error ? error.message : error
      }`;
      this.conversationManager.addMessage("assistant", errorMessage);
      this.updateWebview();
    }
  }

  private async installSpecificMCPServer(serverName: string) {
    const { MCPManager } = await import("../../features/mcp/mcp-manager");
    const mcpManager = new MCPManager();

    // Convert server name to consistent format for storage
    const serverKey = this.getServerKey(serverName);

    // Check if server already exists
    if (mcpManager.hasMCPServer(serverKey)) {
      throw new Error(`${serverName} is already installed`);
    }

    const serverConfig = this.getPopularServerConfig(serverName);
    if (!serverConfig) {
      throw new Error(`Unknown server: ${serverName}`);
    }

    // Add the server configuration with consistent naming
    mcpManager.addMCPServer(serverKey, {
      ...serverConfig,
      displayName: serverName, // Keep original display name
    });
  }

  private getServerKey(serverName: string): string {
    // Convert display name to consistent storage key
    return serverName.toLowerCase().replace(/\s+/g, "-");
  }

  private getPopularServerConfig(serverName: string) {
    const configs: Record<string, any> = {
      Context7: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@context7/mcp-server"],
      },
      "Sequential Thinking": {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-sequential-thinking"],
      },
      Memory: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
      Puppeteer: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-puppeteer"],
      },
      Fetch: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-fetch"],
      },
      Filesystem: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem"],
      },
    };

    return configs[serverName];
  }

  private getServerDescription(serverName: string): string {
    const descriptions: Record<string, string> = {
      Context7:
        "You can now access up-to-date code documentation for any project.",
      "Sequential Thinking":
        "Enhanced step-by-step reasoning capabilities are now available.",
      Memory: "Knowledge graph storage and retrieval system is ready.",
      Puppeteer: "Browser automation tools are now configured for UI testing.",
      Fetch: "HTTP requests and web scraping capabilities are enabled.",
      Filesystem: "File operations and management tools are available.",
    };

    return descriptions[serverName] || "The server is now ready to use.";
  }

  private async addCustomMCPServer(serverConfig: any) {
    try {
      // Validate server configuration
      if (!serverConfig.name || !serverConfig.command) {
        throw new Error("Server name and command are required");
      }

      // Check if server name already exists
      const existingServers = this.uiTestService.getMCPStatus();
      if (
        existingServers.tools.some(
          (tool: any) => tool.toLowerCase() === serverConfig.name.toLowerCase()
        )
      ) {
        throw new Error(
          `Server with name "${serverConfig.name}" already exists`
        );
      }

      // Add server via MCP manager
      const { MCPManager } = await import("../../features/mcp/mcp-manager");
      const mcpManager = new MCPManager();

      mcpManager.addMCPServer(serverConfig.name, {
        type: serverConfig.type,
        command: serverConfig.command,
        args: serverConfig.args || [],
        ...(serverConfig.env && { env: serverConfig.env }),
      });

      // Send success result back to UI
      if (this._view) {
        this._view.webview.postMessage({
          type: "customServerResult",
          data: { success: true },
        });
      }

      // Show success message in chat
      const successMessage =
        `✅ Successfully added custom MCP server "${serverConfig.name}"!\n\n` +
        `**Configuration:**\n` +
        `- Command: \`${serverConfig.command}\`\n` +
        `- Arguments: ${
          serverConfig.args?.length
            ? `\`${serverConfig.args.join(" ")}\``
            : "None"
        }\n` +
        `- Type: ${serverConfig.type}\n` +
        `${
          Object.keys(serverConfig.env || {}).length > 0
            ? `- Environment: ${Object.keys(serverConfig.env).length} variables`
            : ""
        }\n\n` +
        `The server has been saved to your Claude configuration and is ready to use!`;

      this.conversationManager.addMessage("assistant", successMessage);
      this.updateWebview();
    } catch (error) {
      // Send error result back to UI
      if (this._view) {
        this._view.webview.postMessage({
          type: "customServerResult",
          data: {
            success: false,
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
          },
        });
      }

      // Show error message in chat
      const errorMessage = `❌ Failed to add custom MCP server: ${
        error instanceof Error ? error.message : error
      }`;
      this.conversationManager.addMessage("assistant", errorMessage);
      this.updateWebview();
    }
  }

  private async deleteMCPServer(serverName: string) {
    try {
      console.log(
        "ChatViewProvider.deleteMCPServer() - Attempting to delete server:",
        serverName
      );

      const { MCPManager } = await import("../../features/mcp/mcp-manager");
      const mcpManager = new MCPManager();

      // Reload config to ensure latest state
      mcpManager.reloadConfiguration();

      // Check if server exists
      if (!mcpManager.hasMCPServer(serverName)) {
        throw new Error(`Server "${serverName}" not found`);
      }

      console.log(
        "ChatViewProvider.deleteMCPServer() - Server found, proceeding with deletion"
      );

      // Remove the server
      mcpManager.removeMCPServer(serverName);

      console.log(
        "ChatViewProvider.deleteMCPServer() - Server removed, updating UI"
      );

      // Send updated status back to UI
      this.sendMCPServerData();

      // Show success message in chat
      const successMessage = `✅ Successfully deleted MCP server "${serverName}".`;
      this.conversationManager.addMessage("assistant", successMessage);
      this.updateWebview();
    } catch (error) {
      console.error("ChatViewProvider.deleteMCPServer() - Error:", error);

      // Show error message in chat
      const errorMessage = `❌ Failed to delete MCP server "${serverName}": ${
        error instanceof Error ? error.message : error
      }`;
      this.conversationManager.addMessage("assistant", errorMessage);
      this.updateWebview();
    }
  }

  private async editMCPServer(serverName: string) {
    try {
      console.log(
        "ChatViewProvider.editMCPServer() - Edit requested for server:",
        serverName
      );

      // Get the current server configuration
      const { MCPManager } = await import("../../features/mcp/mcp-manager");
      const mcpManager = new MCPManager();
      mcpManager.reloadConfiguration();

      const server = mcpManager.getMCPServer(serverName);

      if (!server) {
        throw new Error(`Server "${serverName}" not found`);
      }

      // Send server data to UI for editing
      if (this._view) {
        this._view.webview.postMessage({
          type: "showEditMCPForm",
          serverData: {
            originalName: serverName,
            name: server.displayName || serverName,
            command: server.command,
            args: server.args.join(" "),
            type: server.type,
            env: server.env
              ? Object.entries(server.env)
                  .map(([key, value]) => `${key}=${value}`)
                  .join("\n")
              : "",
          },
        });
      }
    } catch (error) {
      console.error("ChatViewProvider.editMCPServer() - Error:", error);
      const errorMessage = `❌ Failed to get server details for "${serverName}": ${
        error instanceof Error ? error.message : error
      }`;
      this.conversationManager.addMessage("assistant", errorMessage);
      this.updateWebview();
    }
  }

  private async updateMCPServer(originalServerName: string, serverConfig: any) {
    try {
      console.log(
        "ChatViewProvider.updateMCPServer() - Updating server:",
        originalServerName,
        "with config:",
        serverConfig
      );

      // Validate server configuration
      if (!serverConfig.name || !serverConfig.command) {
        throw new Error("Server name and command are required");
      }

      const { MCPManager } = await import("../../features/mcp/mcp-manager");
      const mcpManager = new MCPManager();
      mcpManager.reloadConfiguration();

      // If the name changed, we need to delete the old one and create a new one
      if (originalServerName !== serverConfig.name) {
        // Check if new name already exists
        if (mcpManager.hasMCPServer(serverConfig.name)) {
          throw new Error(
            `Server with name "${serverConfig.name}" already exists`
          );
        }
        // Remove old server
        mcpManager.removeMCPServer(originalServerName);
      } else {
        // Just updating existing server - remove it first
        mcpManager.removeMCPServer(originalServerName);
      }

      // Add updated server configuration
      mcpManager.addMCPServer(serverConfig.name, {
        type: serverConfig.type,
        command: serverConfig.command,
        args: serverConfig.args || [],
        ...(serverConfig.env && { env: serverConfig.env }),
        ...(serverConfig.name !== originalServerName && {
          displayName: serverConfig.name,
        }),
      });

      // Send success result back to UI
      if (this._view) {
        this._view.webview.postMessage({
          type: "editServerResult",
          data: { success: true },
        });
      }

      // Show success message in chat
      const successMessage =
        `✅ Successfully updated MCP server "${serverConfig.name}"!\n\n` +
        `**Updated Configuration:**\n` +
        `- Command: \`${serverConfig.command}\`\n` +
        `- Arguments: ${
          serverConfig.args?.length
            ? `\`${serverConfig.args.join(" ")}\``
            : "None"
        }\n` +
        `- Type: ${serverConfig.type}\n` +
        `${
          Object.keys(serverConfig.env || {}).length > 0
            ? `- Environment: ${Object.keys(serverConfig.env).length} variables`
            : ""
        }\n\n` +
        `The server configuration has been updated successfully!`;

      this.conversationManager.addMessage("assistant", successMessage);
      this.updateWebview();
    } catch (error) {
      console.error("ChatViewProvider.updateMCPServer() - Error:", error);

      // Send error result back to UI
      if (this._view) {
        this._view.webview.postMessage({
          type: "editServerResult",
          data: {
            success: false,
            error:
              error instanceof Error ? error.message : "Unknown error occurred",
          },
        });
      }

      // Show error message in chat
      const errorMessage = `❌ Failed to update MCP server: ${
        error instanceof Error ? error.message : error
      }`;
      this.conversationManager.addMessage("assistant", errorMessage);
      this.updateWebview();
    }
  }

  private async updateVSCodeConfig(key: string, value: string) {
    try {
      const config = vscode.workspace.getConfiguration("claudeDev");
      await config.update(key, value, vscode.ConfigurationTarget.Global);
      console.log(`Updated claudeDev.${key} to:`, value);
    } catch (error) {
      console.error("Failed to update VSCode configuration:", error);
    }
  }

  private sendCurrentSettings() {
    const config = vscode.workspace.getConfiguration("claudeDev");
    const settings = {
      model: config.get<string>("model", "default"),
      thinkingMode: config.get<string>("thinkingMode", "none"),
    };

    if (this._view) {
      this._view.webview.postMessage({
        type: "syncSettings",
        settings: settings,
      });
    }
  }

  private async sendConversationHistory() {
    const conversations = this.conversationManager.getConversationList();

    // Enhance conversation metadata with last message preview
    const enhancedConversationsPromises = conversations.map(async (conv: any) => {
      try {
        const lastMessage = await this.getLastMessagePreview(conv.id);
        return {
          ...conv,
          lastMessage,
        };
      } catch (error) {
        console.warn(
          `Failed to get preview for conversation ${conv.id}, excluding from history`
        );
        return null;
      }
    });

    const enhancedConversationsResults = await Promise.all(
      enhancedConversationsPromises
    );
    const enhancedConversations = enhancedConversationsResults.filter(
      (conv: any) => conv !== null
    );

    if (this._view) {
      this._view.webview.postMessage({
        type: "conversationHistory",
        conversations: enhancedConversations,
      });
    }
  }

  private async loadSpecificConversation(conversationId: string) {
    try {
      const conversation = await this.conversationManager.loadConversation(
        conversationId
      );
      if (conversation) {
        await this.updateWebview();
      }
    } catch (error) {
      console.error("Failed to load conversation:", error);
    }
  }

  private async getLastMessagePreview(conversationId: string): Promise<string> {
    try {
      const currentConv = this.conversationManager.getCurrentConversation();
      if (
        currentConv &&
        currentConv.metadata.id === conversationId &&
        currentConv.messages.length > 0
      ) {
        const lastMessage =
          currentConv.messages[currentConv.messages.length - 1];
        return lastMessage.content.substring(0, 100);
      }

      // If it's not the current conversation, try to load it briefly to get the last message
      const conversation = await this.conversationManager.loadConversation(
        conversationId
      );
      if (conversation && conversation.messages.length > 0) {
        const lastMessage =
          conversation.messages[conversation.messages.length - 1];
        return lastMessage.content.substring(0, 100);
      }

      return "No messages";
    } catch (error) {
      console.warn(
        `Error getting last message preview for ${conversationId}:`,
        error
      );
      return "No messages";
    }
  }

  private async deleteConversation(conversationId: string) {
    try {
      await this.conversationManager.deleteConversation(conversationId);

      // Send success response to frontend
      if (this._view) {
        this._view.webview.postMessage({
          type: "deleteConversationResult",
          data: {
            conversationId: conversationId,
            success: true,
          },
        });
      }

      // If the deleted conversation was the current one, clear the chat
      const currentConv = this.conversationManager.getCurrentConversation();
      if (!currentConv || currentConv.metadata.id === conversationId) {
        await this.updateWebview();
      }
    } catch (error) {
      // Send error response to frontend
      if (this._view) {
        this._view.webview.postMessage({
          type: "deleteConversationResult",
          data: {
            conversationId: conversationId,
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }
  }

  private async clearAllConversations() {
    try {
      await this.conversationManager.clearAllConversations();

      // Close the history modal and clear current conversation
      if (this._view) {
        this._view.webview.postMessage({
          type: "clearAllHistoryResult",
          data: { success: true },
        });
      }

      // Clear current conversation and update UI
      await this.clearChat();
    } catch (error) {
      if (this._view) {
        this._view.webview.postMessage({
          type: "clearAllHistoryResult",
          data: {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }
  }

  private async openFile(filePath: string) {
    try {
      console.log("Opening file:", filePath);
      
      // Convert the file path to a VSCode URI
      const fileUri = vscode.Uri.file(filePath);
      
      // Open the file in VSCode
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document, vscode.ViewColumn.Active);
      
      console.log("Successfully opened file:", filePath);
    } catch (error) {
      console.error("Failed to open file:", filePath, error);
      
      // Show error message to user
      vscode.window.showErrorMessage(
        `Failed to open file: ${filePath}. ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async runTerminalCommand(command: string) {
    try {
      console.log("Running terminal command:", command);
      
      // Get or create terminal
      let terminal = vscode.window.terminals.find(t => t.name === "Claude Dev");
      if (!terminal) {
        terminal = vscode.window.createTerminal("Claude Dev");
      }
      
      // Show terminal and run command
      terminal.show();
      terminal.sendText(command);
      
      console.log("Successfully sent command to terminal:", command);
    } catch (error) {
      console.error("Failed to run terminal command:", command, error);
      vscode.window.showErrorMessage(
        `Failed to run command: ${command}. ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  private async stopGeneration() {
    try {
      console.log("Stopping AI generation on user request");
      
      // Mark as not generating
      this.isGenerating = false;
      
      // Stop the Claude Code service
      this.claudeCodeService.stopGeneration();
      
      // Clear streaming message ID to prevent further updates
      this.streamingMessageId = null;
      
      // Send confirmation to UI
      if (this._view) {
        this._view.webview.postMessage({
          type: "generationStopped"
        });
      }
    } catch (error) {
      console.error("Failed to stop generation:", error);
    }
  }

  private processSlashCommand(message: string): string {
    if (!message.startsWith("/")) {
      return message;
    }

    const [command, ...args] = message.split(" ");
    const remainingText = args.join(" ");

    const slashCommands: Record<string, string> = {
      "/bug": `Please help me debug this issue. Analyze the problem, identify potential causes, and suggest solutions: ${remainingText}`,
      "/review": `Please review this code for quality, best practices, potential issues, and improvements: ${remainingText}`,
      "/explain": `Please explain this code in detail, including what it does, how it works, and any important concepts: ${remainingText}`,
      "/optimize": `Please analyze this code for performance optimizations and suggest improvements: ${remainingText}`,
      "/refactor": `Please suggest how to refactor this code to improve readability, maintainability, and structure: ${remainingText}`,
      "/test": `Please help me write tests for this code, including unit tests and edge cases: ${remainingText}`,
      "/docs": `Please generate comprehensive documentation for this code: ${remainingText}`,
      "/security": `Please analyze this code for security vulnerabilities and suggest fixes: ${remainingText}`,
      "/fix": `Please help me fix this error or issue: ${remainingText}`,
      "/implement": `Please help me implement this feature or functionality: ${remainingText}`,
      "/design": `Please help me design the architecture for this solution: ${remainingText}`,
      "/api": `Please help me design or implement an API for this: ${remainingText}`,
      "/database": `Please help me design the database schema or queries for this: ${remainingText}`,
      "/deploy": `Please help me with deployment strategies and configuration for this: ${remainingText}`,
      "/performance": `Please analyze the performance characteristics and suggest optimizations: ${remainingText}`,
      "/structure": `Please suggest how to better structure or organize this code: ${remainingText}`,
      "/patterns": `Please identify and suggest appropriate design patterns for this: ${remainingText}`,
      "/migrate": `Please help me migrate this code to a different technology or version: ${remainingText}`,
      "/compare": `Please compare different approaches or technologies for this: ${remainingText}`,
    };

    // Handle help command specially
    if (command === "/help") {
      const helpMessage =
        "**Available Slash Commands:**\n\n" +
        "• `/bug` - Debug issues and identify solutions\n" +
        "• `/review` - Code review for quality and best practices\n" +
        "• `/explain` - Detailed code explanations\n" +
        "• `/optimize` - Performance optimization suggestions\n" +
        "• `/refactor` - Code refactoring advice\n" +
        "• `/test` - Help writing tests\n" +
        "• `/docs` - Generate documentation\n" +
        "• `/security` - Security vulnerability analysis\n" +
        "• `/fix` - Fix errors and issues\n" +
        "• `/implement` - Implementation guidance\n" +
        "• `/design` - Architecture design help\n" +
        "• `/api` - API design and implementation\n" +
        "• `/database` - Database schema and queries\n" +
        "• `/deploy` - Deployment strategies\n" +
        "• `/performance` - Performance analysis\n" +
        "• `/structure` - Code organization\n" +
        "• `/patterns` - Design pattern suggestions\n" +
        "• `/migrate` - Technology migration help\n" +
        "• `/compare` - Compare approaches/technologies\n\n" +
        "Simply type a slash command followed by your question or paste your code!";

      // Show help directly without calling Claude
      this.conversationManager.addMessage("assistant", helpMessage);
      // Note: updateWebview() will be called automatically after this method returns
      return ""; // Return empty to avoid calling Claude
    }

    return slashCommands[command] || message;
  }

  private _getHtmlForWebview(webview: vscode.Webview) {
    return this.htmlTemplateService.getHtmlForWebview(webview);
  }
}
