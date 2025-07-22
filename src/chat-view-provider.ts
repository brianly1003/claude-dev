import * as vscode from 'vscode';
import { ClaudeCodeService, CompletionRequest } from './claude-code-service';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;
}

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'claudeDevChat';
    private _view?: vscode.WebviewView;
    private messages: ChatMessage[] = [];
    private claudeCodeService: ClaudeCodeService;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        claudeCodeService: ClaudeCodeService
    ) {
        this.claudeCodeService = claudeCodeService;
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

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: message.trim(),
            timestamp: Date.now()
        };

        this.messages.push(userMessage);
        this.updateWebview();

        try {
            const context = this.buildContext();
            const completionRequest: CompletionRequest = {
                prompt: message,
                context: context,
                language: 'text'
            };

            const response = await this.claudeCodeService.getCompletion(completionRequest);
            
            console.log('Chat response:', {
                suggestion: response.suggestion,
                error: response.error,
                hasSuggestion: !!response.suggestion,
                suggestionLength: response.suggestion?.length || 0
            });
            
            const assistantMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: response.suggestion && response.suggestion.trim() 
                    ? response.suggestion
                    : (response.error || "Sorry, I couldn't process your request. Please check if Claude Code is properly configured."),
                timestamp: Date.now()
            };

            this.messages.push(assistantMessage);
            this.updateWebview();

        } catch (error) {
            const errorMessage: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'assistant',
                content: `Error: ${error instanceof Error ? error.message : 'Unknown error occurred'}`,
                timestamp: Date.now()
            };

            this.messages.push(errorMessage);
            this.updateWebview();
        }
    }

    private buildContext(): string {
        // Always include workspace information
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let context = '';
        
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

    public clearChat() {
        this.messages = [];
        this.updateWebview();
    }

    private updateWebview() {
        if (this._view) {
            this._view.webview.postMessage({
                type: 'updateMessages',
                messages: this.messages
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
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            margin: 0;
            padding: 0;
            height: 100vh;
            display: flex;
            flex-direction: column;
        }

        .chat-container {
            flex: 1;
            display: flex;
            flex-direction: column;
            height: 100%;
        }

        .messages {
            flex: 1;
            overflow-y: auto;
            padding: 10px;
            scrollbar-width: thin;
        }

        .message {
            margin-bottom: 15px;
            padding: 8px 12px;
            border-radius: 8px;
            max-width: 90%;
            word-wrap: break-word;
        }

        .message.user {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            margin-left: auto;
            text-align: right;
        }

        .message.assistant {
            background-color: var(--vscode-input-background);
            border: 1px solid var(--vscode-input-border);
            margin-right: auto;
        }

        .message pre {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            overflow-x: auto;
            margin: 8px 0;
        }

        .message code {
            background-color: var(--vscode-textCodeBlock-background);
            padding: 2px 4px;
            border-radius: 3px;
            font-family: var(--vscode-editor-font-family);
        }

        .input-container {
            padding: 10px;
            border-top: 1px solid var(--vscode-panel-border);
            background-color: var(--vscode-panel-background);
        }

        .input-row {
            display: flex;
            gap: 8px;
        }

        #messageInput {
            flex: 1;
            padding: 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 4px;
            font-size: inherit;
            font-family: inherit;
            resize: vertical;
            min-height: 20px;
            max-height: 100px;
        }

        #messageInput:focus {
            outline: 1px solid var(--vscode-focusBorder);
        }

        .button {
            padding: 8px 16px;
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 4px;
            cursor: pointer;
            font-size: inherit;
        }

        .button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }

        .button:disabled {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            cursor: not-allowed;
        }

        .empty-state {
            flex: 1;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            color: var(--vscode-descriptionForeground);
            text-align: center;
            padding: 20px;
        }

        .empty-state-icon {
            font-size: 48px;
            margin-bottom: 16px;
            opacity: 0.6;
        }

        .timestamp {
            font-size: 0.8em;
            color: var(--vscode-descriptionForeground);
            margin-top: 4px;
        }

        .loading {
            opacity: 0.7;
        }

        .loading::after {
            content: "...";
            animation: dots 1s steps(5, end) infinite;
        }

        @keyframes dots {
            0%, 20% { 
                color: rgba(0,0,0,0); 
                text-shadow: .25em 0 0 rgba(0,0,0,0), .5em 0 0 rgba(0,0,0,0);
            }
            40% { 
                color: var(--vscode-foreground); 
                text-shadow: .25em 0 0 rgba(0,0,0,0), .5em 0 0 rgba(0,0,0,0);
            }
            60% { 
                text-shadow: .25em 0 0 var(--vscode-foreground), .5em 0 0 rgba(0,0,0,0);
            }
            80%, 100% { 
                text-shadow: .25em 0 0 var(--vscode-foreground), .5em 0 0 var(--vscode-foreground);
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="empty-state">
                <div class="empty-state-icon">💬</div>
                <h3>Welcome to Claude Dev Chat!</h3>
                <p>Ask questions about your code, request explanations, or get help with programming tasks.</p>
                <p>Type your message below to get started.</p>
            </div>
        </div>
        <div class="input-container">
            <div class="input-row">
                <textarea id="messageInput" placeholder="Ask Claude Dev anything..." rows="1"></textarea>
                <button class="button" id="sendButton">Send</button>
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
            sendButton.textContent = 'Sending...';
            
            vscode.postMessage({
                type: 'sendMessage',
                message: message
            });

            messageInput.value = '';
            autoResize();
        }

        function renderMessages(messages) {
            if (messages.length === 0) {
                messagesContainer.innerHTML = \`
                    <div class="empty-state">
                        <div class="empty-state-icon">💬</div>
                        <h3>Welcome to Claude Dev Chat!</h3>
                        <p>Ask questions about your code, request explanations, or get help with programming tasks.</p>
                        <p>Type your message below to get started.</p>
                    </div>
                \`;
                return;
            }

            messagesContainer.innerHTML = messages.map(msg => {
                const time = new Date(msg.timestamp).toLocaleTimeString();
                const content = formatMessageContent(msg.content);
                return \`
                    <div class="message \${msg.role}">
                        <div>\${content}</div>
                        <div class="timestamp">\${time}</div>
                    </div>
                \`;
            }).join('');

            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function formatMessageContent(content) {
            // Simple markdown-like formatting
            let formatted = content
                .replace(/\`\`\`([\\s\\S]*?)\`\`\`/g, '<pre><code>$1</code></pre>')
                .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
                .replace(/\\n/g, '<br>');
            
            return formatted;
        }

        function autoResize() {
            messageInput.style.height = 'auto';
            messageInput.style.height = Math.min(messageInput.scrollHeight, 100) + 'px';
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
                    sendButton.textContent = 'Send';
                    break;
            }
        });
    </script>
</body>
</html>`;
    }
}