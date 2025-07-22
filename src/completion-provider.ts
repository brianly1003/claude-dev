import * as vscode from 'vscode';
import { ClaudeCodeService, CompletionRequest } from './claude-code-service';
import { ContextExtractor } from './context-extractor';

export class ClaudeDevCompletionProvider implements vscode.InlineCompletionItemProvider {
    private claudeCodeService: ClaudeCodeService;
    private contextExtractor: ContextExtractor;
    private pendingRequests: Map<string, Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined>> = new Map();
    private debounceTimeouts: Map<string, NodeJS.Timeout> = new Map();

    constructor(claudeCodeService: ClaudeCodeService) {
        this.claudeCodeService = claudeCodeService;
        this.contextExtractor = new ContextExtractor();
    }

    public async provideInlineCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _context: vscode.InlineCompletionContext,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        if (!vscode.workspace.getConfiguration('claudeDev').get<boolean>('enabled', true)) {
            return null;
        }

        if (token.isCancellationRequested) {
            return null;
        }

        return this.getDebouncedCompletion(document, position, token);
    }

    private async getDebouncedCompletion(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        const requestKey = `${document.uri.toString()}:${position.line}:${position.character}`;
        const debounceMs = vscode.workspace.getConfiguration('claudeDev').get<number>('debounceMs', 300);

        // Clear existing timeout for this request
        const existingTimeout = this.debounceTimeouts.get(requestKey);
        if (existingTimeout) {
            clearTimeout(existingTimeout);
        }

        // Check if we have a pending request
        const existingRequest = this.pendingRequests.get(requestKey);
        if (existingRequest) {
            return existingRequest;
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(async () => {
                this.debounceTimeouts.delete(requestKey);
                
                try {
                    const result = await this.getCompletionsInternal(document, position, token);
                    this.pendingRequests.delete(requestKey);
                    resolve(result);
                } catch (error) {
                    this.pendingRequests.delete(requestKey);
                    console.error('Error in Claude Dev completion provider:', error);
                    resolve(null);
                }
            }, debounceMs);

            this.debounceTimeouts.set(requestKey, timeout);
        });
    }

    private async getCompletionsInternal(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): Promise<vscode.InlineCompletionItem[] | vscode.InlineCompletionList | null | undefined> {
        
        try {
            const currentLine = document.lineAt(position.line).text;
            const textBeforeCursor = currentLine.substring(0, position.character);
            
            if (textBeforeCursor.trim().length === 0) {
                return null;
            }

            const extractedContext = this.contextExtractor.extractContext(document, position);
            
            const completionRequest: CompletionRequest = {
                prompt: textBeforeCursor,
                context: extractedContext,
                language: document.languageId
            };

            if (token.isCancellationRequested) {
                return null;
            }

            const response = await this.claudeCodeService.getCompletion(completionRequest);
            
            if (token.isCancellationRequested) {
                return null;
            }

            if (response.error || !response.suggestion.trim()) {
                return null;
            }

            const suggestion = response.suggestion.trim();
            const remainingLineText = currentLine.substring(position.character);
            
            let insertText = suggestion;
            if (remainingLineText && suggestion.includes(remainingLineText)) {
                insertText = suggestion.substring(0, suggestion.indexOf(remainingLineText));
            }

            if (insertText.length === 0) {
                return null;
            }

            const completionItem = new vscode.InlineCompletionItem(
                insertText,
                new vscode.Range(position, position)
            );

            return [completionItem];
            
        } catch (error) {
            console.error('Error in Claude Dev completion provider:', error);
            return null;
        }
    }
}