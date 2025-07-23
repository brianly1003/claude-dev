import * as vscode from 'vscode';
import * as fs from 'fs';

/**
 * Service for managing HTML templates with separated CSS and JavaScript
 */
export class HtmlTemplateService {
    private extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this.extensionUri = extensionUri;
    }

    /**
     * Get the complete HTML for the chat webview
     */
    public getHtmlForWebview(webview: vscode.Webview): string {
        // Get paths to CSS, JS, and HTML files
        const cssPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'chat-view.css');
        const jsPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'chat-view.js');
        const htmlPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'chat-view.html');

        // Convert to webview URIs
        const cssUri = webview.asWebviewUri(cssPath);
        const jsUri = webview.asWebviewUri(jsPath);

        try {
            // Read the HTML template
            const htmlTemplate = fs.readFileSync(htmlPath.fsPath, 'utf8');

            // Replace placeholders with actual paths
            const html = htmlTemplate
                .replace('{CSS_PATH}', cssUri.toString())
                .replace('{JS_PATH}', jsUri.toString());

            return html;
        } catch (error) {
            console.error('Error loading HTML template:', error);
            // Fallback to inline template if files are not found
            return this.getFallbackHtml();
        }
    }

    /**
     * Get inline CSS content for fallback scenarios
     */
    private getInlineCss(): string {
        const cssPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'chat-view.css');
        try {
            return fs.readFileSync(cssPath.fsPath, 'utf8');
        } catch (error) {
            console.error('Error loading CSS file:', error);
            return '/* CSS not loaded */';
        }
    }

    /**
     * Get inline JavaScript content for fallback scenarios
     */
    private getInlineJs(): string {
        const jsPath = vscode.Uri.joinPath(this.extensionUri, 'src', 'ui', 'chat-view.js');
        try {
            return fs.readFileSync(jsPath.fsPath, 'utf8');
        } catch (error) {
            console.error('Error loading JavaScript file:', error);
            return '// JavaScript not loaded';
        }
    }

    /**
     * Fallback HTML with inline CSS and JavaScript
     */
    private getFallbackHtml(): string {
        const css = this.getInlineCss();
        const js = this.getInlineJs();

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Claude Dev Chat</title>
    <style>${css}</style>
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
            <div class="model-controls">
                <div class="control-group">
                    <label for="modelSelect">Model:</label>
                    <select id="modelSelect" class="control-select" aria-label="Select AI model">
                        <option value="default">Default</option>
                        <option value="opus">Opus</option>
                        <option value="sonnet">Sonnet</option>
                    </select>
                </div>
                <div class="control-group">
                    <label for="thinkingSelect">Thinking:</label>
                    <select id="thinkingSelect" class="control-select" aria-label="Select thinking mode">
                        <option value="none">None</option>
                        <option value="think">Think</option>
                        <option value="think-hard">Think Hard</option>
                        <option value="think-harder">Think Harder</option>
                        <option value="ultrathink">Ultra Think</option>
                    </select>
                </div>
                <div class="control-group">
                    <button id="historyButton" class="history-button" title="Conversation History">
                        📚 History
                    </button>
                </div>
                <div class="control-group token-counter" title="Token usage: current input • total conversation">
                    <span class="token-label" aria-label="Current input tokens">📝</span>
                    <span id="inputTokens" class="token-count" aria-label="Input token count">0</span>
                    <span class="token-separator">•</span>
                    <span class="token-label" aria-label="Total conversation tokens">📊</span>
                    <span id="totalTokens" class="token-count total" aria-label="Total token count">0</span>
                    <span class="token-unit">tokens</span>
                </div>
            </div>
            <div class="input-wrapper">
                <div class="slash-commands-dropdown" id="slashCommandsDropdown">
                    <!-- Autocomplete suggestions will be populated here -->
                </div>
                <div class="input-row">
                    <textarea 
                        id="messageInput" 
                        placeholder="Ask me anything or use slash commands (/bug, /review, /explain, /fix, etc.)..."
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

    <!-- Conversation History Modal -->
    <div class="history-modal-overlay" id="historyModalOverlay">
        <div class="history-modal">
            <div class="history-modal-header">
                <h2 class="history-modal-title">Conversation History</h2>
                <button class="history-close-button" id="historyCloseBtn">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.3 5.71c-.39-.39-1.02-.39-1.41 0L12 10.59 7.11 5.7c-.39-.39-1.02-.39-1.41 0s-.39 1.02 0 1.41L10.59 12 5.7 16.89c-.39.39-.39 1.02 0 1.41s1.02.39 1.41 0L12 13.41l4.89 4.88c.39.39 1.02.39 1.41 0s.39-1.02 0-1.41L13.41 12l4.88-4.89c.39-.39.39-1.02.01-1.4z"/>
                    </svg>
                </button>
            </div>
            <div class="history-modal-content">
                <div class="history-conversation-list" id="historyConversationList">
                    <div class="history-loading">Loading conversations...</div>
                </div>
            </div>
        </div>
    </div>

    <script>${js}</script>
</body>
</html>`;
    }
}