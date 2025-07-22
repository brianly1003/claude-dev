import * as vscode from 'vscode';
import { ClaudeCodeService, CompletionRequest, StreamingCompletionOptions } from './claude-code-service';
import { ConversationManager } from './conversation-manager';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeDevChat';
    private _view?: vscode.WebviewView;
    private claudeCodeService: ClaudeCodeService;
    private conversationManager: ConversationManager;
    private streamingMessageId: string | null = null;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        claudeCodeService: ClaudeCodeService,
        context: vscode.ExtensionContext
    ) {
        this.claudeCodeService = claudeCodeService;
        this.conversationManager = new ConversationManager(context);
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
    </div>

    <div class="chat-container">
        <div class="messages" id="messages">
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

    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const messageInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        let isWaiting = false;

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
            }
        });

        // Initialize
        autoResize();
    </script>
</body>
</html>`;
    }
}