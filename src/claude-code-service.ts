import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import * as vscode from "vscode";

export interface ClaudeCodeConfig {
  claudeCodePath?: string; // Optional now since SDK can auto-detect
  enableLogging: boolean;
  workspaceRoot?: string;
  yoloMode?: boolean; // Enable automatic permission approval
}

export interface CompletionRequest {
  prompt: string;
  context: string;
  language: string;
}

export interface CompletionResponse {
  suggestion: string;
  error?: string;
}

export class ClaudeCodeService {
  private config: ClaudeCodeConfig;
  private outputChannel: vscode.OutputChannel;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
    this.outputChannel = vscode.window.createOutputChannel("Claude Dev");
  }

  public updateConfig(config: ClaudeCodeConfig): void {
    this.config = config;
  }

  private log(message: string): void {
    if (this.config.enableLogging) {
      const timestamp = new Date().toISOString();
      this.outputChannel.appendLine(`[${timestamp}] ${message}`);
    }
  }

  public async getCompletion(
    request: CompletionRequest
  ): Promise<CompletionResponse> {
    this.log(`Requesting completion for ${request.language} code using SDK`);

    try {
      const prompt = this.buildPrompt(request);
      const messages: SDKMessage[] = [];
      let accumulatedResponse = "";

      this.log(`Sending prompt: ${prompt.substring(0, 100)}...`);
      
      if (this.config.yoloMode !== false) {
        this.log(`YOLO Mode enabled - using --dangerously-skip-permissions flag`);
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        this.log(`Aborting multi-turn conversation after 120 seconds`);
        abortController.abort();
      }, 120000); // 2 minutes for multi-turn conversations with tool usage

      try {
        const queryOptions: any = {
          prompt: prompt,
          abortController: abortController,
          options: {
            maxTurns: 5, // Allow multi-turn conversations so Claude can execute actions
          },
          cwd: this.getCurrentWorkingDirectory(),
          // Pass CLI arguments through executableArgs (like claude-code-chat does)
          executableArgs: this.config.yoloMode !== false ? [
            '--dangerously-skip-permissions' // This bypasses all permission prompts!
          ] : [],
        };

        // Only set pathToClaudeCodeExecutable if provided
        if (this.config.claudeCodePath) {
          queryOptions.pathToClaudeCodeExecutable = this.config.claudeCodePath;
        }

        for await (const message of query(queryOptions)) {
          messages.push(message);
          
          // Log message type for debugging
          this.log(`Received message type: ${message.type}`);
          
          if (message.type === 'assistant' && message.message) {
            const assistantMessage = message.message;
            
            // Log what Claude is doing
            this.log(`Assistant message with ${assistantMessage.content?.length || 0} content blocks`);
            
            // Content is in message.content array
            if (assistantMessage.content && Array.isArray(assistantMessage.content)) {
              for (const block of assistantMessage.content) {
                if (block.type === 'text' && block.text) {
                  accumulatedResponse += block.text + '\n\n';
                  this.log(`Added text: "${block.text.substring(0, 100)}..."`);
                } else if (block.type === 'tool_use') {
                  this.log(`Claude is using tool: ${block.name} with input: ${JSON.stringify(block.input).substring(0, 100)}...`);
                  accumulatedResponse += `[Using tool: ${block.name}]\n`;
                }
              }
            }
            this.log(`Total accumulated response: ${accumulatedResponse.length} characters`);
          } else if (message.type === 'result') {
            this.log(`Tool result received: ${JSON.stringify(message).substring(0, 200)}...`);
          } else {
            this.log(`Other message type (${message.type}): ${JSON.stringify(message).substring(0, 200)}...`);
          }
        }

        clearTimeout(timeout);

        if (accumulatedResponse.trim()) {
          this.log(`Final response: ${accumulatedResponse.substring(0, 100)}...`);
          return { suggestion: accumulatedResponse.trim() };
        } else {
          return { suggestion: "", error: "No response received from Claude Code SDK" };
        }

      } catch (error: any) {
        clearTimeout(timeout);
        if (error.name === 'AbortError') {
          this.log(`Request was aborted`);
          return { suggestion: "", error: "Request timeout" };
        }
        throw error;
      }

    } catch (error: any) {
      this.log(`SDK error: ${error.message}`);
      return { suggestion: "", error: `Claude Code SDK error: ${error.message}` };
    }
  }

  // Removed executeClaudeCode - now using SDK directly

  private getCurrentWorkingDirectory(): string {
    const workingDir = this.config.workspaceRoot || process.cwd();
    this.log(`Using working directory: ${workingDir}`);
    this.log(`Available workspace root from config: ${this.config.workspaceRoot}`);
    this.log(`Process cwd fallback: ${process.cwd()}`);
    return workingDir;
  }

  private buildPrompt(request: CompletionRequest): string {
    if (request.language === "text" || !request.context.includes("---")) {
      // This is a chat request, not a code completion
      return `You are Claude Dev, an AI coding assistant. Please help with the following request:

${request.prompt}

Context:
${request.context}

Please provide a helpful response.`;
    }

    return `Complete the following ${request.language} code. Provide only the completion, no explanations:

Context:
${request.context}

Complete this code:
${request.prompt}`;
  }

  public dispose(): void {
    this.outputChannel.dispose();
  }
}
