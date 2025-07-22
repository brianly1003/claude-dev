import * as vscode from 'vscode';
import { ClaudeCodeService, CompletionRequest, StreamingCompletionOptions } from './claude-code-service';
import { ConversationManager } from './conversation-manager';
import { MCPUITesting } from './mcp-ui-testing';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeDevChat';
    private _view?: vscode.WebviewView;
    private claudeCodeService: ClaudeCodeService;
    private conversationManager: ConversationManager;
    private mcpUITesting: MCPUITesting;
    private streamingMessageId: string | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        claudeCodeService: ClaudeCodeService,
        context: vscode.ExtensionContext
    ) {
        this.claudeCodeService = claudeCodeService;
        this.conversationManager = new ConversationManager(context);
        this.mcpUITesting = new MCPUITesting(claudeCodeService);
        this.loadMostRecentConversation();
    }

    private async loadMostRecentConversation(): Promise<void> {
        const recent = await this.conversationManager.loadMostRecentConversation();
        if (recent) {
            // Update webview if it's already initialized
            if (this._view) {
                this.updateWebview();
            }
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async data => {
            switch (data.type) {
                case 'sendMessage':
                    await this.handleUserMessage(data.message);
                    break;
                case 'clearChat':
                    this.clearChat();
                    break;
                case 'openMCPModal':
                    this.sendMCPServerData();
                    break;
                case 'installMCPServer':
                    await this.installMCPServer(data.serverName);
                    break;
                case 'addCustomMCPServer':
                    await this.addCustomMCPServer(data.serverConfig);
                    break;
                case 'deleteMCPServer':
                    await this.deleteMCPServer(data.serverName);
                    break;
                case 'editMCPServer':
                    await this.editMCPServer(data.serverName);
                    break;
            }
        });
    }

    private async handleUserMessage(message: string) {
        if (!message.trim()) {
            return;
        }

        // Add user message to conversation and auto-save
        this.conversationManager.addMessage('user', message.trim());
        this.updateWebview();

        // Check if this is an MCP UI testing request (priority over basic UI testing)
        if (message.toLowerCase().includes('mcp') || 
            message.toLowerCase().includes('configure mcp') ||
            message.toLowerCase().includes('list mcp') ||
            message.toLowerCase().includes('ui test') || 
            message.toLowerCase().includes('test ui') || 
            message.toLowerCase().includes('playwright') || 
            message.toLowerCase().includes('browser test') ||
            message.toLowerCase().includes('create test')) {
            
            // Handle MCP UI testing with real browser automation
            const mcpResponse = await this.mcpUITesting.handleUITestingChat(message);
            this.conversationManager.addMessage('assistant', mcpResponse);
            this.updateWebview();
            return;
        }

        // Create a streaming assistant message placeholder
        const streamingMessage = this.conversationManager.addMessage('assistant', '...');
        this.streamingMessageId = streamingMessage.id;
        this.updateWebview();

        try {
            const context = this.buildContext();
            const completionRequest: CompletionRequest = {
                prompt: message,
                context: context,
                language: 'text'
            };

            const streamingOptions: StreamingCompletionOptions = {
                onStreamingUpdate: (partialResponse: string, isComplete: boolean) => {
                    this.handleStreamingUpdate(partialResponse, isComplete);
                }
            };

            const response = await this.claudeCodeService.getCompletion(completionRequest, streamingOptions);
            
            console.log('Chat response:', {
                suggestion: response.suggestion,
                error: response.error,
                hasSuggestion: !!response.suggestion,
                suggestionLength: response.suggestion?.length || 0
            });
            
            const responseContent = response.suggestion && response.suggestion.trim() 
                ? response.suggestion
                : (response.error || "Sorry, I couldn't process your request. Please check if Claude Code is properly configured.");

            // Update the streaming message with final content
            this.updateStreamingMessage(responseContent, true);

        } catch (error) {
            const errorContent = `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`;
            
            // Update the streaming message with error content
            this.updateStreamingMessage(errorContent, true);
        }
    }

    private buildContext(): string {
        // Include conversation history first
        let context = this.conversationManager.getConversationContext() + '\n\n';
        
        // Always include workspace information
        const workspaceFolders = vscode.workspace.workspaceFolders;
        
        if (workspaceFolders && workspaceFolders.length > 0) {
            context += `--- Current Workspace ---\n`;
            workspaceFolders.forEach((folder, index) => {
                context += `${index + 1}. ${folder.name}: ${folder.uri.fsPath}\n`;
            });
            context += '\n';
        } else {
            context += `--- No Workspace Detected ---\n`;
            context += 'Note: Please open a folder/project in VSCode for Claude to explore\n\n';
        }

        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            return context + 'No active file open';
        }

        const document = activeEditor.document;
        const selection = activeEditor.selection;
        
        context += `--- Current File: ${document.fileName} (${document.languageId}) ---\n`;
        
        if (!selection.isEmpty) {
            const selectedText = document.getText(selection);
            context += `--- Selected Code ---\n${selectedText}\n\n`;
        }

        const maxLines = 30;
        const totalLines = document.lineCount;
        const startLine = Math.max(0, Math.min(selection.start.line - 15, totalLines - maxLines));
        const endLine = Math.min(totalLines, startLine + maxLines);
        
        context += `--- Context (lines ${startLine + 1}-${endLine}) ---\n`;
        for (let i = startLine; i < endLine; i++) {
            const line = document.lineAt(i).text;
            const linePrefix = i === selection.start.line ? '> ' : '  ';
            context += `${linePrefix}${i + 1}: ${line}\n`;
        }

        return context;
    }

    private handleStreamingUpdate(partialResponse: string, isComplete: boolean) {
        this.updateStreamingMessage(partialResponse, isComplete);
    }

    private updateStreamingMessage(content: string, isComplete: boolean) {
        if (!this.streamingMessageId) return;

        const currentConversation = this.conversationManager.getCurrentConversation();
        if (!currentConversation) return;

        // Find and update the streaming message
        const messageIndex = currentConversation.messages.findIndex(msg => msg.id === this.streamingMessageId);
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

    private sendStreamingUpdate(messageId: string, content: string, isComplete: boolean) {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'streamingUpdate',
                messageId: messageId,
                content: content,
                isComplete: isComplete
            });
        }
    }

    public clearChat() {
        this.conversationManager.clearHistory();
        this.conversationManager.startNewConversation();
        this.updateWebview();
    }

    private updateWebview() {
        if (this._view) {
            const currentConversation = this.conversationManager.getCurrentConversation();
            const messages = currentConversation ? currentConversation.messages : [];
            
            this._view.webview.postMessage({
                type: 'updateMessages',
                messages: messages
            });
        }
    }

    private sendMCPServerData() {
        if (this._view) {
            const mcpStatus = this.mcpUITesting.getMCPStatus();
            const detailedServers = this.mcpUITesting.getDetailedMCPServers();
            
            this._view.webview.postMessage({
                type: 'showMCPModal',
                data: {
                    configured: mcpStatus.configured,
                    tools: mcpStatus.tools,
                    configuredServers: detailedServers,
                    configPath: mcpStatus.configPath
                }
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
            const successMessage = `✅ Successfully installed ${serverName} MCP server! ${this.getServerDescription(serverName)}`;
            this.conversationManager.addMessage('assistant', successMessage);
            this.updateWebview();
            
        } catch (error) {
            // Show error message in chat
            const errorMessage = `❌ Failed to install ${serverName}: ${error instanceof Error ? error.message : error}`;
            this.conversationManager.addMessage('assistant', errorMessage);
            this.updateWebview();
        }
    }

    private async installSpecificMCPServer(serverName: string) {
        const { MCPManager } = await import('./mcp-manager');
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
            displayName: serverName  // Keep original display name
        });
    }

    private getServerKey(serverName: string): string {
        // Convert display name to consistent storage key
        return serverName.toLowerCase().replace(/\s+/g, '-');
    }

    private getPopularServerConfig(serverName: string) {
        const configs: Record<string, any> = {
            'Context7': {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@context7/mcp-server']
            },
            'Sequential Thinking': {
                type: 'stdio', 
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-sequential-thinking']
            },
            'Memory': {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-memory']
            },
            'Puppeteer': {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-puppeteer']
            },
            'Fetch': {
                type: 'stdio',
                command: 'npx', 
                args: ['-y', '@modelcontextprotocol/server-fetch']
            },
            'Filesystem': {
                type: 'stdio',
                command: 'npx',
                args: ['-y', '@modelcontextprotocol/server-filesystem']
            }
        };

        return configs[serverName];
    }

    private getServerDescription(serverName: string): string {
        const descriptions: Record<string, string> = {
            'Context7': 'You can now access up-to-date code documentation for any project.',
            'Sequential Thinking': 'Enhanced step-by-step reasoning capabilities are now available.',
            'Memory': 'Knowledge graph storage and retrieval system is ready.',
            'Puppeteer': 'Browser automation tools are now configured for UI testing.',
            'Fetch': 'HTTP requests and web scraping capabilities are enabled.',
            'Filesystem': 'File operations and management tools are available.'
        };

        return descriptions[serverName] || 'The server is now ready to use.';
    }

    private async addCustomMCPServer(serverConfig: any) {
        try {
            // Validate server configuration
            if (!serverConfig.name || !serverConfig.command) {
                throw new Error('Server name and command are required');
            }

            // Check if server name already exists
            const existingServers = await this.mcpUITesting.getMCPStatus();
            if (existingServers.tools.some(tool => tool.toLowerCase() === serverConfig.name.toLowerCase())) {
                throw new Error(`Server with name "${serverConfig.name}" already exists`);
            }

            // Add server via MCP manager
            const { MCPManager } = await import('./mcp-manager');
            const mcpManager = new MCPManager();
            
            mcpManager.addMCPServer(serverConfig.name, {
                type: serverConfig.type,
                command: serverConfig.command,
                args: serverConfig.args || [],
                ...(serverConfig.env && { env: serverConfig.env })
            });

            // Send success result back to UI
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'customServerResult',
                    data: { success: true }
                });
            }

            // Show success message in chat
            const successMessage = `✅ Successfully added custom MCP server "${serverConfig.name}"!\n\n` +
                `**Configuration:**\n` +
                `- Command: \`${serverConfig.command}\`\n` +
                `- Arguments: ${serverConfig.args?.length ? `\`${serverConfig.args.join(' ')}\`` : 'None'}\n` +
                `- Type: ${serverConfig.type}\n` +
                `${Object.keys(serverConfig.env || {}).length > 0 ? `- Environment: ${Object.keys(serverConfig.env).length} variables` : ''}\n\n` +
                `The server has been saved to your Claude configuration and is ready to use!`;
            
            this.conversationManager.addMessage('assistant', successMessage);
            this.updateWebview();

        } catch (error) {
            // Send error result back to UI
            if (this._view) {
                this._view.webview.postMessage({
                    type: 'customServerResult',
                    data: { 
                        success: false, 
                        error: error instanceof Error ? error.message : 'Unknown error occurred'
                    }
                });
            }

            // Show error message in chat
            const errorMessage = `❌ Failed to add custom MCP server: ${error instanceof Error ? error.message : error}`;
            this.conversationManager.addMessage('assistant', errorMessage);
            this.updateWebview();
        }
    }

    private async deleteMCPServer(serverName: string) {
        try {
            const { MCPManager } = await import('./mcp-manager');
            const mcpManager = new MCPManager();
            
            // Check if server exists
            if (!mcpManager.hasMCPServer(serverName)) {
                throw new Error(`Server "${serverName}" not found`);
            }

            // Remove the server
            mcpManager.removeMCPServer(serverName);

            // Send updated status back to UI
            this.sendMCPServerData();

            // Show success message in chat
            const successMessage = `✅ Successfully deleted MCP server "${serverName}".`;
            this.conversationManager.addMessage('assistant', successMessage);
            this.updateWebview();

        } catch (error) {
            // Show error message in chat
            const errorMessage = `❌ Failed to delete MCP server "${serverName}": ${error instanceof Error ? error.message : error}`;
            this.conversationManager.addMessage('assistant', errorMessage);
            this.updateWebview();
        }
    }

    private async editMCPServer(serverName: string) {
        // For now, show a message that editing is not yet implemented
        // In the future, this could open a pre-populated form
        const message = `ℹ️ Editing MCP servers is not yet implemented. You can delete "${serverName}" and add a new one with updated configuration.`;
        this.conversationManager.addMessage('assistant', message);
        this.updateWebview();
    }

    private _getHtmlForWebview(_webview: vscode.Webview) {
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Dev Chat</title>
    <style>
        :root {
            --claude-gradient: linear-gradient(135deg, #FF6B35 0%, #FF8E53 50%, #FFA07A 100%);
            --claude-accent: #FF6B35;
            --claude-accent-hover: #FF8E53;
            --claude-accent-light: rgba(255, 107, 53, 0.1);
            --claude-shadow: 0 4px 20px rgba(255, 107, 53, 0.15);
            --border-radius: 12px;
            --border-radius-small: 8px;
            --spacing: 16px;
            --animation-duration: 0.2s;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family: var(--vscode-font-family), -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background: linear-gradient(135deg, var(--vscode-editor-background) 0%, var(--vscode-panel-background) 100%);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
        }

        .chat-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: var(--spacing);
            background: var(--vscode-titleBar-activeBackground);
            border-bottom: 1px solid var(--vscode-panel-border);
            backdrop-filter: blur(10px);
        }

        .chat-title {
            display: flex;
            align-items: center;
            gap: 12px;
            font-weight: 600;
            font-size: 16px;
        }

        .claude-logo {
            width: 28px;
            height: 28px;
            background: var(--claude-gradient);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 14px;
            box-shadow: var(--claude-shadow);
        }

        .status-indicator {
            width: 8px;
            height: 8px;
            background: #4ADE80;
            border-radius: 50%;
            animation: pulse 2s infinite;
        }

        .mcp-header-btn {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            border-radius: 6px;
            padding: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
            display: flex;
            align-items: center;
            justify-content: center;
        }

        .mcp-header-btn:hover {
            background: var(--claude-accent);
            color: white;
            transform: scale(1.05);
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
        }

        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
            overflow: hidden;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: var(--spacing);
            scroll-behavior: smooth;
            scrollbar-width: thin;
            scrollbar-color: var(--vscode-scrollbarSlider-background) transparent;
        }

        .messages::-webkit-scrollbar {
            width: 6px;
        }

        .messages::-webkit-scrollbar-track {
            background: transparent;
        }

        .messages::-webkit-scrollbar-thumb {
            background: var(--vscode-scrollbarSlider-background);
            border-radius: 3px;
        }

        .message {
            margin-bottom: 24px;
            animation: messageIn var(--animation-duration) ease-out;
        }

        @keyframes messageIn {
            from {
                opacity: 0;
                transform: translateY(10px);
            }
            to {
                opacity: 1;
                transform: translateY(0);
            }
        }

        .message-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }

        .message-avatar {
            width: 20px;
            height: 20px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 10px;
        }

        .message.user .message-avatar {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }

        .message.assistant .message-avatar {
            background: var(--claude-gradient);
            color: white;
        }

        .message-content {
            padding: 16px 20px;
            border-radius: var(--border-radius);
            line-height: 1.6;
            position: relative;
        }

        .message.user .message-content {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: 60px;
            border-bottom-right-radius: var(--border-radius-small);
            word-wrap: break-word;
            overflow-wrap: break-word;
            max-width: 100%;
            box-sizing: border-box;
        }

        .message.assistant .message-content {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            margin-right: 60px;
            border-bottom-left-radius: var(--border-radius-small);
            box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            word-wrap: break-word;
            overflow-wrap: break-word;
            max-width: 100%;
            box-sizing: border-box;
        }

        .message pre {
            background: var(--vscode-textCodeBlock-background);
            padding: 16px;
            border-radius: var(--border-radius-small);
            overflow-x: auto;
            margin: 12px 0;
            border-left: 3px solid var(--claude-accent);
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
            white-space: pre-wrap;
            word-wrap: break-word;
            max-width: 100%;
            box-sizing: border-box;
        }

        .message code {
            background: var(--claude-accent-light);
            color: var(--claude-accent);
            padding: 3px 6px;
            border-radius: 4px;
            font-family: var(--vscode-editor-font-family);
            font-size: 0.9em;
        }

        .input-container {
            padding: 12px;
            background: var(--vscode-panel-background);
            border-top: 1px solid var(--vscode-panel-border);
        }

        .input-wrapper {
            position: relative;
            background: var(--vscode-input-background);
            border: 2px solid var(--vscode-input-border);
            border-radius: var(--border-radius);
            transition: all var(--animation-duration) ease;
        }

        .input-wrapper:focus-within {
            border-color: var(--claude-accent);
            box-shadow: 0 0 0 3px var(--claude-accent-light);
        }

        .input-row {
            display: flex;
            align-items: flex-end;
            gap: 8px;
            padding: 8px 12px;
        }

        #messageInput {
            flex: 1;
            border: none;
            background: transparent;
            color: var(--vscode-input-foreground);
            font-size: 14px;
            font-family: inherit;
            resize: none;
            outline: none;
            min-height: 20px;
            max-height: 100px;
            line-height: 1.4;
        }

        #messageInput::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .send-button {
            width: 28px;
            height: 28px;
            background: var(--claude-gradient);
            color: white;
            border: none;
            border-radius: 50%;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all var(--animation-duration) ease;
            box-shadow: var(--claude-shadow);
            flex-shrink: 0;
        }

        .send-button:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 25px rgba(255, 107, 53, 0.25);
        }

        .send-button:disabled {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .send-icon {
            width: 14px;
            height: 14px;
            transition: transform var(--animation-duration) ease;
        }

        .send-button:hover:not(:disabled) .send-icon {
            transform: translateX(1px);
        }

        /* Streaming cursor animation */
        .streaming-cursor {
            color: var(--claude-accent);
            font-weight: bold;
            animation: blink 1s infinite;
            margin-left: 2px;
        }

        @keyframes blink {
            0%, 50% { opacity: 1; }
            51%, 100% { opacity: 0; }
        }

        .empty-state {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            padding: 40px 20px;
        }

        .empty-state-logo {
            width: 80px;
            height: 80px;
            background: var(--claude-gradient);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            font-weight: bold;
            font-size: 36px;
            margin-bottom: 24px;
            box-shadow: var(--claude-shadow);
            animation: float 3s ease-in-out infinite;
        }

        @keyframes float {
            0%, 100% { transform: translateY(0px); }
            50% { transform: translateY(-10px); }
        }

        .empty-state h2 {
            margin: 0 0 16px 0;
            font-size: 24px;
            background: var(--claude-gradient);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            background-clip: text;
        }

        .empty-state p {
            margin: 0 0 12px 0;
            line-height: 1.6;
            opacity: 0.8;
        }

        .feature-list {
            list-style: none;
            padding: 0;
            margin: 24px 0;
            text-align: left;
            max-width: 300px;
        }

        .feature-list li {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 8px 0;
            color: var(--vscode-descriptionForeground);
        }

        .feature-icon {
            width: 20px;
            height: 20px;
            border-radius: 4px;
            background: var(--claude-accent-light);
            color: var(--claude-accent);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 12px;
        }

        /* MCP Modal Styles */
        .mcp-modal-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.7);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
            backdrop-filter: blur(4px);
            opacity: 0;
            visibility: hidden;
            transition: all 0.3s ease;
        }

        .mcp-modal-overlay.visible {
            opacity: 1;
            visibility: visible;
        }

        .mcp-modal {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: var(--border-radius);
            width: 90%;
            max-width: 650px;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            transform: scale(0.95) translateY(-20px);
            transition: transform 0.3s ease;
        }

        .mcp-modal-content {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
        }

        .mcp-modal-overlay.visible .mcp-modal {
            transform: scale(1) translateY(0);
        }

        .mcp-modal-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 24px;
            border-bottom: 1px solid var(--vscode-panel-border);
        }

        .mcp-modal-title {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin: 0;
        }

        .mcp-close-button {
            background: none;
            border: none;
            color: var(--vscode-descriptionForeground);
            cursor: pointer;
            padding: 8px;
            border-radius: 4px;
            transition: background 0.2s ease;
        }

        .mcp-close-button:hover {
            background: var(--vscode-button-secondaryBackground);
        }


        .mcp-section {
            margin-bottom: 32px;
        }

        .mcp-section-title {
            font-size: 14px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 16px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .mcp-section-status {
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .mcp-section-status.configured {
            background: #4ADE80;
            color: #064e3b;
        }

        .mcp-add-server-btn {
            background: var(--claude-gradient);
            color: white;
            border: none;
            padding: 12px 20px;
            border-radius: var(--border-radius-small);
            cursor: pointer;
            font-weight: 500;
            transition: all 0.2s ease;
            margin-bottom: 24px;
        }

        .mcp-add-server-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 4px 12px rgba(255, 107, 53, 0.25);
        }

        .mcp-servers-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
            gap: 16px;
            margin-top: 16px;
        }

        .mcp-configured-servers {
            display: flex;
            flex-direction: column;
            gap: 16px;
            margin-top: 16px;
        }

        .mcp-configured-server {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: var(--border-radius-small);
            padding: 20px;
            position: relative;
        }

        .mcp-configured-server-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            margin-bottom: 12px;
        }

        .mcp-configured-server-name {
            font-size: 18px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin: 0;
        }

        .mcp-configured-server-actions {
            display: flex;
            gap: 8px;
        }

        .mcp-configured-action-btn {
            padding: 6px 12px;
            border: 1px solid var(--vscode-input-border);
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .mcp-configured-action-btn:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .mcp-configured-action-btn.delete {
            background: rgba(248, 113, 113, 0.1);
            color: #DC2626;
            border-color: #F87171;
        }

        .mcp-configured-action-btn.delete:hover {
            background: rgba(248, 113, 113, 0.2);
        }

        .mcp-connection-type {
            background: var(--claude-accent);
            color: white;
            padding: 2px 8px;
            border-radius: 4px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            display: inline-block;
            margin-bottom: 12px;
        }

        .mcp-configured-server-details {
            display: flex;
            flex-direction: column;
            gap: 8px;
            color: var(--vscode-descriptionForeground);
            font-size: 13px;
        }

        .mcp-configured-server-detail {
            display: flex;
            align-items: flex-start;
            gap: 8px;
        }

        .mcp-configured-server-label {
            font-weight: 600;
            min-width: 80px;
            color: var(--vscode-foreground);
        }

        .mcp-configured-server-value {
            font-family: var(--vscode-editor-font-family);
            background: var(--vscode-textCodeBlock-background);
            padding: 2px 6px;
            border-radius: 3px;
            flex: 1;
        }

        .mcp-server-card {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: var(--border-radius-small);
            padding: 20px;
            cursor: pointer;
            transition: all 0.2s ease;
            position: relative;
        }

        .mcp-server-card:hover {
            border-color: var(--claude-accent);
            transform: translateY(-2px);
            box-shadow: 0 8px 25px rgba(0, 0, 0, 0.1);
        }

        .mcp-server-card.installed {
            background: var(--claude-accent-light);
            border-color: var(--claude-accent);
        }

        .mcp-server-icon {
            width: 40px;
            height: 40px;
            border-radius: var(--border-radius-small);
            background: var(--claude-gradient);
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 600;
            font-size: 18px;
            margin-bottom: 16px;
        }

        .mcp-server-name {
            font-size: 16px;
            font-weight: 600;
            color: var(--vscode-foreground);
            margin-bottom: 8px;
        }

        .mcp-server-description {
            font-size: 13px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            margin-bottom: 16px;
        }

        .mcp-install-status {
            position: absolute;
            top: 16px;
            right: 16px;
            padding: 4px 8px;
            border-radius: 12px;
            font-size: 10px;
            font-weight: 600;
            text-transform: uppercase;
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }

        .mcp-install-status.installed {
            background: #4ADE80;
            color: #064e3b;
        }

        .mcp-install-status.installing {
            background: var(--claude-accent);
            color: white;
            animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.7; }
        }

        .mcp-no-servers {
            text-align: center;
            color: var(--vscode-descriptionForeground);
            font-style: italic;
            padding: 40px 20px;
        }

        /* Custom MCP Server Form Styles */
        .mcp-form-modal {
            max-width: 500px;
            width: 95%;
        }

        .mcp-server-form {
            display: flex;
            flex-direction: column;
            gap: 20px;
        }

        .mcp-form-row {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }

        .mcp-form-label {
            font-size: 13px;
            font-weight: 600;
            color: var(--vscode-foreground);
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .mcp-required {
            color: #F87171;
            font-weight: 500;
        }

        .mcp-form-input, .mcp-form-select, .mcp-form-textarea {
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            color: var(--vscode-input-foreground);
            border-radius: var(--border-radius-small);
            padding: 12px;
            font-size: 13px;
            font-family: inherit;
            transition: all 0.2s ease;
            outline: none;
        }

        .mcp-form-input:focus, .mcp-form-select:focus, .mcp-form-textarea:focus {
            border-color: var(--claude-accent);
            box-shadow: 0 0 0 2px var(--claude-accent-light);
        }

        .mcp-form-input::placeholder, .mcp-form-textarea::placeholder {
            color: var(--vscode-input-placeholderForeground);
        }

        .mcp-form-help {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            line-height: 1.4;
            margin-top: -4px;
        }

        .mcp-form-select {
            cursor: pointer;
        }

        .mcp-form-textarea {
            resize: vertical;
            min-height: 80px;
            font-family: var(--vscode-editor-font-family);
        }

        .mcp-advanced-section {
            border: 1px solid var(--vscode-panel-border);
            border-radius: var(--border-radius-small);
            overflow: hidden;
        }

        .mcp-advanced-toggle {
            width: 100%;
            background: var(--vscode-button-secondaryBackground);
            border: none;
            padding: 12px 16px;
            color: var(--vscode-button-secondaryForeground);
            font-size: 13px;
            font-weight: 500;
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            transition: all 0.2s ease;
        }

        .mcp-advanced-toggle:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .mcp-chevron {
            transition: transform 0.2s ease;
        }

        .mcp-advanced-section.expanded .mcp-chevron {
            transform: rotate(90deg);
        }

        .mcp-advanced-content {
            display: none;
            padding: 16px;
            background: var(--vscode-editor-background);
            border-top: 1px solid var(--vscode-panel-border);
        }

        .mcp-advanced-section.expanded .mcp-advanced-content {
            display: block;
            animation: expandDown 0.2s ease;
        }

        @keyframes expandDown {
            from { opacity: 0; transform: translateY(-10px); }
            to { opacity: 1; transform: translateY(0); }
        }

        .mcp-form-error {
            background: rgba(248, 113, 113, 0.1);
            border: 1px solid #F87171;
            color: #DC2626;
            border-radius: var(--border-radius-small);
            padding: 12px;
            font-size: 13px;
            margin-top: -8px;
        }

        .mcp-form-actions {
            display: flex;
            gap: 12px;
            justify-content: flex-end;
            margin-top: 8px;
            padding-top: 20px;
            border-top: 1px solid var(--vscode-panel-border);
        }

        .mcp-btn-secondary, .mcp-btn-primary {
            padding: 10px 20px;
            border-radius: var(--border-radius-small);
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s ease;
            border: 1px solid transparent;
            display: flex;
            align-items: center;
            gap: 8px;
            min-width: 100px;
            justify-content: center;
        }

        .mcp-btn-secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border-color: var(--vscode-input-border);
        }

        .mcp-btn-secondary:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }

        .mcp-btn-primary {
            background: var(--claude-gradient);
            color: white;
            box-shadow: var(--claude-shadow);
        }

        .mcp-btn-primary:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 25px rgba(255, 107, 53, 0.25);
        }

        .mcp-btn-primary:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
            box-shadow: none;
        }

        .mcp-btn-spinner {
            animation: spin 1s linear infinite;
        }

        @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
        }

        .typing-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            padding: 16px 20px;
            background: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            border-radius: var(--border-radius);
            margin-right: 60px;
            margin-bottom: 24px;
            animation: messageIn var(--animation-duration) ease-out;
        }

        .typing-dots {
            display: flex;
            gap: 4px;
        }

        .typing-dot {
            width: 6px;
            height: 6px;
            background: var(--claude-accent);
            border-radius: 50%;
            animation: typing 1.4s infinite ease-in-out;
        }

        .typing-dot:nth-child(1) { animation-delay: 0s; }
        .typing-dot:nth-child(2) { animation-delay: 0.2s; }
        .typing-dot:nth-child(3) { animation-delay: 0.4s; }

        @keyframes typing {
            0%, 60%, 100% { transform: scale(1); opacity: 0.5; }
            30% { transform: scale(1.2); opacity: 1; }
        }
    </style>
</head>
<body>
    <div class="chat-header">
        <div class="chat-title">
            <div class="claude-logo">C</div>
            <span>Claude Dev</span>
            <div class="status-indicator"></div>
        </div>
        <button class="mcp-header-btn" id="mcpServerBtn" title="MCP Servers">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
            </svg>
        </button>
    </div>

    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="empty-state">
                <div class="empty-state-logo">C</div>
                <h2>Brian Dev Assistant</h2>
                <p>Your AI-powered coding companion</p>
                <p>I can explore your codebase, explain complex logic, implement features, and help debug issues.</p>
                
                <ul class="feature-list">
                    <li><div class="feature-icon">📁</div> Explore project structure</li>
                    <li><div class="feature-icon">🔍</div> Analyze and explain code</li>
                    <li><div class="feature-icon">✨</div> Generate new features</li>
                    <li><div class="feature-icon">🐛</div> Debug and fix issues</li>
                </ul>
            </div>
        </div>
        
        <div class="input-container">
            <div class="input-wrapper">
                <div class="input-row">
                    <textarea 
                        id="messageInput" 
                        placeholder="Ask me about your code, request features, or get help debugging..."
                        rows="1"
                    ></textarea>
                    <button class="send-button" id="sendButton">
                        <svg class="send-icon" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
                        </svg>
                    </button>
                </div>
            </div>
        </div>
    </div>

    <!-- MCP Modal -->
    <div class="mcp-modal-overlay" id="mcpModalOverlay">
        <div class="mcp-modal">
            <div class="mcp-modal-header">
                <h2 class="mcp-modal-title">MCP Servers</h2>
                <button class="mcp-close-button" id="mcpCloseBtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.3 5.71c-.39-.39-1.02-.39-1.41 0L12 10.59 7.11 5.7c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41L10.59 12 5.7 16.89c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0L12 13.41l4.89 4.88c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L13.41 12l4.88-4.89c.39-.39.39-1.02.01-1.4z"/>
                    </svg>
                </button>
            </div>
            <div class="mcp-modal-content">
                <div class="mcp-section">
                    <div class="mcp-section-title">
                        Configured Servers
                        <span class="mcp-section-status" id="configuredStatus">0 configured</span>
                    </div>
                    <div id="configuredServers" class="mcp-no-servers">
                        No MCP servers configured
                    </div>
                    <button class="mcp-add-server-btn" id="addServerBtn">
                        + Add MCP Server
                    </button>
                </div>
                
                <div class="mcp-section">
                    <div class="mcp-section-title">Popular MCP Servers</div>
                    <div class="mcp-servers-grid" id="popularServers">
                        <!-- Popular servers will be populated by JavaScript -->
                    </div>
                </div>
            </div>
        </div>
    </div>

    <!-- Custom MCP Server Form Modal -->
    <div class="mcp-modal-overlay" id="customServerModalOverlay">
        <div class="mcp-modal mcp-form-modal">
            <div class="mcp-modal-header">
                <h2 class="mcp-modal-title">Add Custom MCP Server</h2>
                <button class="mcp-close-button" id="customServerCloseBtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.3 5.71c-.39-.39-1.02-.39-1.41 0L12 10.59 7.11 5.7c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41L10.59 12 5.7 16.89c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0L12 13.41l4.89 4.88c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L13.41 12l4.88-4.89c.39-.39.39-1.02.01-1.4z"/>
                    </svg>
                </button>
            </div>
            <div class="mcp-modal-content">
                <form class="mcp-server-form" id="customServerForm">
                    <div class="mcp-form-row">
                        <label class="mcp-form-label" for="serverName">
                            Server Name <span class="mcp-required">*</span>
                        </label>
                        <input type="text" id="serverName" name="serverName" class="mcp-form-input" 
                               placeholder="e.g., my-custom-server" required>
                        <div class="mcp-form-help">Unique identifier for your MCP server</div>
                    </div>

                    <div class="mcp-form-row">
                        <label class="mcp-form-label" for="serverCommand">
                            Command <span class="mcp-required">*</span>
                        </label>
                        <input type="text" id="serverCommand" name="serverCommand" class="mcp-form-input" 
                               placeholder="e.g., npx, python, node" required>
                        <div class="mcp-form-help">Executable command to run the MCP server</div>
                    </div>

                    <div class="mcp-form-row">
                        <label class="mcp-form-label" for="serverArgs">
                            Arguments
                        </label>
                        <input type="text" id="serverArgs" name="serverArgs" class="mcp-form-input" 
                               placeholder="e.g., @my/mcp-server --port 3000">
                        <div class="mcp-form-help">Space-separated command line arguments</div>
                    </div>

                    <div class="mcp-form-row">
                        <label class="mcp-form-label" for="serverType">
                            Connection Type <span class="mcp-required">*</span>
                        </label>
                        <select id="serverType" name="serverType" class="mcp-form-select" required>
                            <option value="stdio">Standard I/O (stdio)</option>
                            <option value="sse">Server-Sent Events (sse)</option>
                        </select>
                        <div class="mcp-form-help">How the MCP client connects to the server</div>
                    </div>

                    <div class="mcp-form-row mcp-advanced-section">
                        <button type="button" class="mcp-advanced-toggle" id="advancedToggle">
                            <svg class="mcp-chevron" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M8.59 16.58L13.17 12L8.59 7.41L10 6l6 6-6 6-1.41-1.42z"/>
                            </svg>
                            Advanced Configuration
                        </button>
                        <div class="mcp-advanced-content" id="advancedContent">
                            <div class="mcp-form-row">
                                <label class="mcp-form-label" for="serverEnv">Environment Variables</label>
                                <textarea id="serverEnv" name="serverEnv" class="mcp-form-textarea" rows="4"
                                          placeholder="KEY1=value1&#10;KEY2=value2&#10;API_TOKEN=your-token"></textarea>
                                <div class="mcp-form-help">One environment variable per line (KEY=value format)</div>
                            </div>
                        </div>
                    </div>

                    <div class="mcp-form-error" id="formError" style="display: none;"></div>

                    <div class="mcp-form-actions">
                        <button type="button" class="mcp-btn-secondary" id="cancelCustomServer">Cancel</button>
                        <button type="submit" class="mcp-btn-primary" id="saveCustomServer">
                            <span class="mcp-btn-text">Add Server</span>
                            <div class="mcp-btn-spinner" style="display: none;">
                                <svg width="16" height="16" viewBox="0 0 24 24">
                                    <path d="M12,4a8,8,0,0,1,7.89,6.7A1.53,1.53,0,0,0,21.38,12h0a1.5,1.5,0,0,0,1.48-1.75,11,11,0,0,0-21.72,0A1.5,1.5,0,0,0,2.62,12h0a1.53,1.53,0,0,0,1.49-1.3A8,8,0,0,1,12,4Z" fill="currentColor"/>
                                    <animateTransform attributeName="transform" dur="0.75s" values="0 12 12;360 12 12" repeatCount="indefinite" type="rotate"/>
                                </svg>
                            </div>
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        const mcpModal = document.getElementById('mcpModalOverlay');
        const mcpServerBtn = document.getElementById('mcpServerBtn');
        const mcpCloseBtn = document.getElementById('mcpCloseBtn');
        const customServerModal = document.getElementById('customServerModalOverlay');
        const addServerBtn = document.getElementById('addServerBtn');
        const customServerCloseBtn = document.getElementById('customServerCloseBtn');
        const customServerForm = document.getElementById('customServerForm');
        const advancedToggle = document.getElementById('advancedToggle');
        const cancelCustomServer = document.getElementById('cancelCustomServer');
        let isWaiting = false;

        // Popular MCP servers data
        const popularServers = [
            {
                name: 'Context7',
                icon: '📖',
                description: 'Up-to-date Code Docs For Any Project',
                category: 'documentation'
            },
            {
                name: 'Sequential Thinking',
                icon: '🧠',
                description: 'Step-by-step reasoning capabilities',
                category: 'reasoning'
            },
            {
                name: 'Memory',
                icon: '🧠',
                description: 'Knowledge graph storage',
                category: 'storage'
            },
            {
                name: 'Puppeteer',
                icon: '🎭',
                description: 'Browser automation',
                category: 'automation'
            },
            {
                name: 'Fetch',
                icon: '🌐',
                description: 'HTTP requests & web scraping',
                category: 'networking'
            },
            {
                name: 'Filesystem',
                icon: '📁',
                description: 'File operations & management',
                category: 'files'
            }
        ];

        // Custom Server Form Functions
        function showCustomServerForm() {
            hideMCPModal();
            resetCustomServerForm();
            customServerModal.classList.add('visible');
        }

        function hideCustomServerForm() {
            customServerModal.classList.remove('visible');
        }

        function resetCustomServerForm() {
            customServerForm.reset();
            hideFormError();
            setSubmitButtonState(false);
            
            // Reset advanced section
            const advancedSection = document.querySelector('.mcp-advanced-section');
            advancedSection.classList.remove('expanded');
        }

        function toggleAdvancedConfig() {
            const advancedSection = document.querySelector('.mcp-advanced-section');
            advancedSection.classList.toggle('expanded');
        }

        function showFormError(message) {
            const errorDiv = document.getElementById('formError');
            errorDiv.textContent = message;
            errorDiv.style.display = 'block';
        }

        function hideFormError() {
            const errorDiv = document.getElementById('formError');
            errorDiv.style.display = 'none';
        }

        function setSubmitButtonState(loading) {
            const submitBtn = document.getElementById('saveCustomServer');
            const btnText = submitBtn.querySelector('.mcp-btn-text');
            const btnSpinner = submitBtn.querySelector('.mcp-btn-spinner');
            
            submitBtn.disabled = loading;
            btnText.style.display = loading ? 'none' : 'block';
            btnSpinner.style.display = loading ? 'block' : 'none';
        }

        function validateServerForm(formData) {
            const errors = [];
            
            // Validate required fields
            if (!formData.name?.trim()) {
                errors.push('Server name is required');
            } else if (!/^[a-zA-Z0-9_-]+$/.test(formData.name.trim())) {
                errors.push('Server name can only contain letters, numbers, hyphens, and underscores');
            }
            
            if (!formData.command?.trim()) {
                errors.push('Command is required');
            }
            
            if (!formData.type) {
                errors.push('Connection type is required');
            }
            
            // Validate environment variables format if provided
            if (formData.env?.trim()) {
                const envLines = formData.env.split('\\n').filter(line => line.trim());
                for (const line of envLines) {
                    if (!line.includes('=') || line.startsWith('=')) {
                        errors.push('Environment variables must be in KEY=value format');
                        break;
                    }
                }
            }
            
            return errors;
        }

        function parseEnvironmentVariables(envText) {
            if (!envText?.trim()) return {};
            
            const env = {};
            const lines = envText.split('\\n').filter(line => line.trim());
            
            for (const line of lines) {
                const [key, ...valueParts] = line.split('=');
                if (key?.trim() && valueParts.length > 0) {
                    env[key.trim()] = valueParts.join('=');
                }
            }
            
            return env;
        }

        function handleCustomServerSubmit(event) {
            event.preventDefault();
            hideFormError();
            
            // Get form data
            const formData = {
                name: document.getElementById('serverName').value.trim(),
                command: document.getElementById('serverCommand').value.trim(),
                args: document.getElementById('serverArgs').value.trim(),
                type: document.getElementById('serverType').value,
                env: document.getElementById('serverEnv').value.trim()
            };
            
            // Validate form
            const errors = validateServerForm(formData);
            if (errors.length > 0) {
                showFormError(errors[0]);
                return;
            }
            
            // Parse arguments and environment variables
            const args = formData.args ? formData.args.split(/\\s+/).filter(arg => arg) : [];
            const env = parseEnvironmentVariables(formData.env);
            
            // Prepare server configuration
            const serverConfig = {
                name: formData.name,
                command: formData.command,
                args: args,
                type: formData.type,
                ...(Object.keys(env).length > 0 && { env })
            };
            
            // Show loading state
            setSubmitButtonState(true);
            
            // Send to backend
            vscode.postMessage({
                type: 'addCustomMCPServer',
                serverConfig: serverConfig
            });
        }

        // MCP Modal Functions
        function showMCPModal() {
            vscode.postMessage({ type: 'openMCPModal' });
        }

        function hideMCPModal() {
            mcpModal.classList.remove('visible');
        }

        function renderPopularServers(configuredTools = [], configuredServers = []) {
            const popularGrid = document.getElementById('popularServers');
            
            popularGrid.innerHTML = popularServers.map(server => {
                // Check if server is installed by checking both simple tool names and detailed server configs
                const isInstalled = configuredTools.some(tool => 
                    tool.toLowerCase().includes(server.name.toLowerCase().replace(/\s+/g, '')) ||
                    tool.toLowerCase().includes(server.name.toLowerCase())
                ) || configuredServers.some(configServer => {
                    const serverKey = server.name.toLowerCase().replace(/\s+/g, '-');
                    const displayName = configServer.displayName || configServer.name;
                    return configServer.name === serverKey || 
                           displayName.toLowerCase() === server.name.toLowerCase();
                });
                
                return \`
                    <div class="mcp-server-card \${isInstalled ? 'installed' : ''}" 
                         data-server="\${server.name}"
                         style="\${isInstalled ? 'cursor: default;' : 'cursor: pointer;'}">
                        <div class="mcp-install-status \${isInstalled ? 'installed' : ''}">
                            \${isInstalled ? 'Installed' : 'Install'}
                        </div>
                        <div class="mcp-server-icon">\${server.icon}</div>
                        <div class="mcp-server-name">\${server.name}</div>
                        <div class="mcp-server-description">\${server.description}</div>
                    </div>
                \`;
            }).join('');

            // Add click event listeners after rendering
            const serverCards = popularGrid.querySelectorAll('.mcp-server-card');
            serverCards.forEach(card => {
                const serverName = card.getAttribute('data-server');
                const isInstalled = card.classList.contains('installed');
                
                if (!isInstalled) {
                    card.addEventListener('click', () => handleServerInstallClick(serverName));
                }
            });
        }

        function handleServerInstallClick(serverName) {
            console.log('Installing MCP server:', serverName);
            
            // Find the card and update its state to show loading
            const card = document.querySelector(\`[data-server="\${serverName}"]\`);
            if (!card) {
                console.error('Server card not found:', serverName);
                return;
            }
            
            // Update card to show loading state
            const installStatus = card.querySelector('.mcp-install-status');
            const originalText = installStatus.textContent;
            
            installStatus.textContent = 'Installing...';
            installStatus.classList.add('installing');
            card.style.pointerEvents = 'none';
            card.style.opacity = '0.7';
            
            // Send installation request
            console.log('Sending install request for:', serverName);
            vscode.postMessage({ 
                type: 'installMCPServer', 
                serverName: serverName 
            });
            
            // Reset state after timeout (in case of error)
            setTimeout(() => {
                if (installStatus.textContent === 'Installing...') {
                    console.warn('Installation timeout for:', serverName);
                    installStatus.textContent = originalText;
                    installStatus.classList.remove('installing');
                    card.style.pointerEvents = '';
                    card.style.opacity = '';
                }
            }, 10000); // 10 second timeout
        }


        function updateMCPModal(data) {
            console.log('Updating MCP Modal with data:', data);
            const configuredStatus = document.getElementById('configuredStatus');
            const configuredServers = document.getElementById('configuredServers');
            
            if (data.configured && data.configuredServers && data.configuredServers.length > 0) {
                configuredStatus.textContent = \`\${data.configuredServers.length} configured\`;
                configuredStatus.classList.add('configured');
                
                configuredServers.innerHTML = \`
                    <div class="mcp-configured-servers">
                        \${data.configuredServers.map(server => {
                            const displayName = server.displayName || server.name;
                            const args = server.args ? server.args.join(' ') : '';
                            
                            return \`
                                <div class="mcp-configured-server">
                                    <div class="mcp-configured-server-header">
                                        <h3 class="mcp-configured-server-name">\${displayName.toLowerCase()}</h3>
                                        <div class="mcp-configured-server-actions">
                                            <button class="mcp-configured-action-btn" data-action="edit" data-server="\${server.name}">Edit</button>
                                            <button class="mcp-configured-action-btn delete" data-action="delete" data-server="\${server.name}">Delete</button>
                                        </div>
                                    </div>
                                    <div class="mcp-connection-type">\${server.type.toUpperCase()}</div>
                                    <div class="mcp-configured-server-details">
                                        <div class="mcp-configured-server-detail">
                                            <span class="mcp-configured-server-label">Command:</span>
                                            <span class="mcp-configured-server-value">\${server.command}</span>
                                        </div>
                                        \${args ? \`
                                            <div class="mcp-configured-server-detail">
                                                <span class="mcp-configured-server-label">Args:</span>
                                                <span class="mcp-configured-server-value">\${args}</span>
                                            </div>
                                        \` : ''}
                                        \${server.env && Object.keys(server.env).length > 0 ? \`
                                            <div class="mcp-configured-server-detail">
                                                <span class="mcp-configured-server-label">Environment:</span>
                                                <span class="mcp-configured-server-value">\${Object.keys(server.env).length} variables</span>
                                            </div>
                                        \` : ''}
                                    </div>
                                </div>
                            \`;
                        }).join('')}
                    </div>
                \`;

                // Add event listeners for Edit/Delete buttons after rendering
                setTimeout(() => {
                    const actionButtons = configuredServers.querySelectorAll('.mcp-configured-action-btn');
                    console.log('Found action buttons:', actionButtons.length);
                    
                    actionButtons.forEach(btn => {
                        btn.addEventListener('click', (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            
                            const action = btn.getAttribute('data-action');
                            const serverName = btn.getAttribute('data-server');
                            
                            console.log('Button clicked:', action, serverName);
                            
                            if (action === 'delete') {
                                handleDeleteServer(serverName);
                            } else if (action === 'edit') {
                                handleEditServer(serverName);
                            }
                        });
                    });
                }, 100); // Small delay to ensure DOM is ready
            } else {
                configuredStatus.textContent = '0 configured';
                configuredStatus.classList.remove('configured');
                configuredServers.innerHTML = '<div class="mcp-no-servers">No MCP servers configured</div>';
            }
            
            renderPopularServers(data.tools, data.configuredServers || []);
            mcpModal.classList.add('visible');
        }

        // Event Listeners
        mcpServerBtn.addEventListener('click', showMCPModal);
        mcpCloseBtn.addEventListener('click', hideMCPModal);
        
        mcpModal.addEventListener('click', (e) => {
            if (e.target === mcpModal) {
                hideMCPModal();
            }
        });

        // Custom Server Form Event Listeners
        addServerBtn.addEventListener('click', showCustomServerForm);
        customServerCloseBtn.addEventListener('click', hideCustomServerForm);
        cancelCustomServer.addEventListener('click', hideCustomServerForm);
        advancedToggle.addEventListener('click', toggleAdvancedConfig);
        customServerForm.addEventListener('submit', handleCustomServerSubmit);
        
        customServerModal.addEventListener('click', (e) => {
            if (e.target === customServerModal) {
                hideCustomServerForm();
            }
        });

        // Real-time form validation
        document.getElementById('serverName').addEventListener('input', hideFormError);
        document.getElementById('serverCommand').addEventListener('input', hideFormError);

        function handleCustomServerResult(data) {
            setSubmitButtonState(false);
            
            if (data.success) {
                // Success - hide form and update main modal
                hideCustomServerForm();
                
                // Refresh MCP modal with updated data
                showMCPModal();
                
                // Show success message in chat
                // (This will be handled by the backend sending a chat message)
                
            } else {
                // Show error in form
                showFormError(data.error || 'Failed to add MCP server. Please check your configuration.');
            }
        }

        function handleDeleteServer(serverName) {
            if (confirm(\`Are you sure you want to delete the "\${serverName}" MCP server?\`)) {
                console.log('Deleting server:', serverName);
                vscode.postMessage({
                    type: 'deleteMCPServer',
                    serverName: serverName
                });
            }
        }

        function handleEditServer(serverName) {
            // For now, just show a message that editing is not implemented
            // In the future, this could open the custom server form pre-populated
            console.log('Edit server:', serverName);
            vscode.postMessage({
                type: 'editMCPServer', 
                serverName: serverName
            });
        }

        function sendMessage() {
            const message = messageInput.value.trim();
            if (!message || isWaiting) return;

            isWaiting = true;
            sendButton.disabled = true;
            showTypingIndicator();
            
            vscode.postMessage({
                type: 'sendMessage',
                message: message
            });

            messageInput.value = '';
            autoResize();
        }

        function showTypingIndicator() {
            const typingHtml = \`
                <div class="typing-indicator">
                    <div class="message-avatar" style="background: var(--claude-gradient); color: white;">C</div>
                    <span style="color: var(--vscode-descriptionForeground);">Claude is thinking</span>
                    <div class="typing-dots">
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                        <div class="typing-dot"></div>
                    </div>
                </div>
            \`;
            
            const emptyState = messagesContainer.querySelector('.empty-state');
            if (emptyState) {
                emptyState.style.display = 'none';
            }
            
            messagesContainer.insertAdjacentHTML('beforeend', typingHtml);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function hideTypingIndicator() {
            const typingIndicator = messagesContainer.querySelector('.typing-indicator');
            if (typingIndicator) {
                typingIndicator.remove();
            }
        }

        function renderMessages(messages) {
            hideTypingIndicator();
            
            if (messages.length === 0) {
                messagesContainer.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-logo">C</div>
                        <h2>Brian Dev Assistant</h2>
                        <p>Your AI-powered coding companion</p>
                        <p>I can explore your codebase, explain complex logic, implement features, and help debug issues.</p>
                        
                        <ul class="feature-list">
                            <li><div class="feature-icon">📁</div> Explore project structure</li>
                            <li><div class="feature-icon">🔍</div> Analyze and explain code</li>
                            <li><div class="feature-icon">✨</div> Generate new features</li>
                            <li><div class="feature-icon">🐛</div> Debug and fix issues</li>
                        </ul>
                    </div>
                \`;
                return;
            }

            const emptyState = messagesContainer.querySelector('.empty-state');
            if (emptyState) {
                emptyState.style.display = 'none';
            }

            messagesContainer.innerHTML = messages.map(msg => {
                const time = new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const content = formatMessageContent(msg.content);
                const isUser = msg.role === 'user';
                const avatar = isUser ? 'You' : 'C';
                const sender = isUser ? 'You' : 'Claude';
                
                return \`
                    <div class="message \${msg.role}" data-message-id="\${msg.id}">
                        <div class="message-header">
                            <div class="message-avatar">\${avatar}</div>
                            <span>\${sender}</span>
                            <span>•</span>
                            <span>\${time}</span>
                        </div>
                        <div class="message-content">\${content}</div>
                    </div>
                \`;
            }).join('');

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function formatMessageContent(content) {
            // Enhanced markdown-like formatting
            let formatted = content
                .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/\\*\\*([^\\*]+)\\*\\*/g, '<strong>$1</strong>')
                .replace(/\\*([^\\*]+)\\*/g, '<em>$1</em>')
                .replace(/\\n/g, '<br>');
            
            return formatted;
        }

        function updateStreamingMessage(messageId, content, isComplete) {
            // Find existing message element by data attribute or create new one
            const existingMessage = messagesContainer.querySelector(\`[data-message-id="\${messageId}"]\`);
            
            if (existingMessage) {
                // Update existing streaming message
                const contentElement = existingMessage.querySelector('.message-content');
                if (contentElement) {
                    const formattedContent = formatMessageContent(content);
                    contentElement.innerHTML = formattedContent + (isComplete ? '' : '<span class="streaming-cursor">|</span>');
                }
            } else {
                // Create new streaming message if not found
                const time = new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                const formattedContent = formatMessageContent(content);
                
                const messageHtml = \`
                    <div class="message assistant" data-message-id="\${messageId}">
                        <div class="message-header">
                            <div class="message-avatar">C</div>
                            <span>Claude</span>
                            <span>•</span>
                            <span>\${time}</span>
                        </div>
                        <div class="message-content">\${formattedContent}\${isComplete ? '' : '<span class="streaming-cursor">|</span>'}</div>
                    </div>
                \`;
                
                messagesContainer.insertAdjacentHTML('beforeend', messageHtml);
            }
            
            // Auto-scroll to bottom
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
            
            // Remove streaming cursor when complete
            if (isComplete) {
                const cursor = messagesContainer.querySelector(\`[data-message-id="\${messageId}"] .streaming-cursor\`);
                if (cursor) {
                    cursor.remove();
                }
            }
        }

        function autoResize() {
            messageInput.style.height = 'auto';
            const newHeight = Math.min(messageInput.scrollHeight, 100);
            messageInput.style.height = newHeight + 'px';
        }

        messageInput.addEventListener('input', autoResize);
        messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
            }
        });

        sendButton.addEventListener('click', sendMessage);

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'updateMessages':
                    renderMessages(message.messages);
                    isWaiting = false;
                    sendButton.disabled = false;
                    break;
                case 'streamingUpdate':
                    updateStreamingMessage(message.messageId, message.content, message.isComplete);
                    if (message.isComplete) {
                        isWaiting = false;
                        sendButton.disabled = false;
                    }
                    break;
                case 'showMCPModal':
                    updateMCPModal(message.data);
                    break;
                case 'customServerResult':
                    handleCustomServerResult(message.data);
                    break;
            }
        });

        // Initialize
        autoResize();
    </script>
</body>
</html>`;
    }
}