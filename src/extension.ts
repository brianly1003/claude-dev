import * as vscode from 'vscode';
import { ClaudeCodeService } from './claude-code-service';
import { ClaudeDevCompletionProvider } from './completion-provider';
import { ChatViewProvider } from './chat-view-provider';

let claudeCodeService: ClaudeCodeService;
let completionProvider: ClaudeDevCompletionProvider;
let chatViewProvider: ChatViewProvider;
let statusBarItem: vscode.StatusBarItem;
let completionProviderDisposable: vscode.Disposable | undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Claude Dev extension is now active!');

    initializeService();
    createStatusBarItem();
    registerCompletionProvider();
    registerChatView(context);
    registerCommands(context);
    
    vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('claudeDev')) {
            updateConfiguration();
        }
    });
}

function initializeService() {
    const config = vscode.workspace.getConfiguration('claudeDev');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    console.log('Claude Dev: Detected workspace folders:', vscode.workspace.workspaceFolders?.map(f => f.uri.fsPath));
    console.log('Claude Dev: Using workspace root:', workspaceRoot);
    
    claudeCodeService = new ClaudeCodeService({
        claudeCodePath: config.get<string>('claudeCodePath', 'claude'),
        enableLogging: config.get<boolean>('enableLogging', false),
        workspaceRoot: workspaceRoot,
        yoloMode: config.get<boolean>('yoloMode', true)
    });
}

function createStatusBarItem() {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'claudeDev.toggle';
    updateStatusBarItem();
    statusBarItem.show();
}

function updateStatusBarItem() {
    const enabled = vscode.workspace.getConfiguration('claudeDev').get<boolean>('enabled', true);
    statusBarItem.text = `$(symbol-misc) Claude Dev ${enabled ? '$(check)' : '$(x)'}`;
    statusBarItem.tooltip = `Claude Dev is ${enabled ? 'enabled' : 'disabled'}. Click to toggle.`;
}

function registerCompletionProvider() {
    completionProvider = new ClaudeDevCompletionProvider(claudeCodeService);
    
    const languages = [
        'typescript', 'javascript', 'python', 'java', 'cpp', 'c',
        'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin',
        'scala', 'html', 'css', 'json', 'yaml', 'markdown'
    ];
    
    completionProviderDisposable = vscode.languages.registerInlineCompletionItemProvider(
        languages.map(lang => ({ language: lang })),
        completionProvider
    );
}

function registerChatView(context: vscode.ExtensionContext) {
    chatViewProvider = new ChatViewProvider(context.extensionUri, claudeCodeService, context);
    
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatViewProvider)
    );
}

function registerCommands(context: vscode.ExtensionContext) {
    const toggleCommand = vscode.commands.registerCommand('claudeDev.toggle', async () => {
        const config = vscode.workspace.getConfiguration('claudeDev');
        const currentEnabled = config.get<boolean>('enabled', true);
        
        await config.update('enabled', !currentEnabled, vscode.ConfigurationTarget.Global);
        updateStatusBarItem();
        
        vscode.window.showInformationMessage(
            `Claude Dev ${!currentEnabled ? 'enabled' : 'disabled'}`
        );
    });

    const triggerCompletionCommand = vscode.commands.registerCommand('claudeDev.triggerCompletion', () => {
        vscode.commands.executeCommand('editor.action.inlineSuggest.trigger');
    });

    const openChatCommand = vscode.commands.registerCommand('claudeDev.openChat', () => {
        vscode.commands.executeCommand('claudeDevChat.focus');
    });

    const clearChatCommand = vscode.commands.registerCommand('claudeDev.clearChat', () => {
        if (chatViewProvider) {
            chatViewProvider.clearChat();
        }
    });

    const configureMCPCommand = vscode.commands.registerCommand('claudeDev.configureMCP', () => {
        if (chatViewProvider) {
            // Trigger MCP configuration through chat
            vscode.commands.executeCommand('claudeDevChat.focus');
            vscode.window.showInformationMessage('Type "Configure MCP for UI testing" in the Claude Dev chat to set up browser automation.');
        }
    });

    const openMCPModalCommand = vscode.commands.registerCommand('claudeDev.openMCPModal', () => {
        if (chatViewProvider) {
            vscode.commands.executeCommand('claudeDevChat.focus');
            // The modal will be triggered by the button in the chat UI
        }
    });

    context.subscriptions.push(
        toggleCommand,
        triggerCompletionCommand,
        openChatCommand,
        clearChatCommand,
        configureMCPCommand,
        openMCPModalCommand,
        statusBarItem,
        completionProviderDisposable!
    );
}

function updateConfiguration() {
    const config = vscode.workspace.getConfiguration('claudeDev');
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    claudeCodeService.updateConfig({
        claudeCodePath: config.get<string>('claudeCodePath', 'claude'),
        enableLogging: config.get<boolean>('enableLogging', false),
        workspaceRoot: workspaceRoot,
        yoloMode: config.get<boolean>('yoloMode', true)
    });
    
    updateStatusBarItem();
    
    if (completionProviderDisposable) {
        completionProviderDisposable.dispose();
    }
    registerCompletionProvider();
}

export function deactivate() {
    if (claudeCodeService) {
        claudeCodeService.dispose();
    }
}