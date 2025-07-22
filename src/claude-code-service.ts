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

export interface StreamingCompletionOptions {
  onStreamingUpdate?: (partialResponse: string, isComplete: boolean) => void;
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
    request: CompletionRequest,
    options?: StreamingCompletionOptions
  ): Promise<CompletionResponse> {
    this.log(`Requesting completion for ${request.language} code using SDK`);

    try {
      const prompt = this.buildPrompt(request);
      const messages: SDKMessage[] = [];
      let accumulatedResponse = "";

      this.log(`Sending prompt: ${prompt.substring(0, 100)}...`);
      
      if (this.config.yoloMode !== false) {
        this.log(`YOLO Mode enabled - using flags: --dangerously-skip-permissions, --permission-mode bypassPermissions, --add-dir ${this.getCurrentWorkingDirectory()}, --verbose, --allowedTools [all tools]`);
      } else {
        this.log(`YOLO Mode disabled - user will be prompted for permissions`);
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => {
        this.log(`Aborting multi-turn conversation after 120 seconds`);
        abortController.abort();
      }, 120000); // 2 minutes for multi-turn conversations with tool usage

      try {
        const execArgs = [];
        if (this.config.yoloMode !== false) {
          execArgs.push('--dangerously-skip-permissions');
          execArgs.push('--permission-mode');
          execArgs.push('bypassPermissions');
          // Also try adding workspace directory explicitly
          execArgs.push('--add-dir');
          execArgs.push(this.getCurrentWorkingDirectory());
          // Add verbose mode to see what's happening
          execArgs.push('--verbose');
          // Try additional permission-related flags
          execArgs.push('--allowedTools');
          execArgs.push('Bash,LS,Read,Edit,Write,Glob,Grep,Task,MultiEdit,NotebookRead,NotebookEdit');
        }
        
        const queryOptions: any = {
          prompt: prompt,
          abortController: abortController,
          options: {
            maxTurns: 5, // Allow multi-turn conversations so Claude can execute actions
            // Based on GitHub research - try different permission approaches
            allowedTools: ['Bash', 'LS', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'Task', 'MultiEdit', 'NotebookRead', 'NotebookEdit'],
            useCommitSigning: false, // Disable to allow more Bash operations
          },
          cwd: this.getCurrentWorkingDirectory(),
          // Pass CLI arguments through executableArgs (like claude-code-chat does)
          executableArgs: execArgs,
          // Try additional SDK-level permission settings
          dangerouslySkipPermissions: true,
          permissionMode: 'bypassPermissions',
        };

        // Always set pathToClaudeCodeExecutable to force CLI usage
        queryOptions.pathToClaudeCodeExecutable = this.config.claudeCodePath || 'claude';
        
        // Force the SDK to use subprocess mode  
        queryOptions.useSubprocess = true;

        this.log(`Final query options: ${JSON.stringify({
          ...queryOptions,
          prompt: `${queryOptions.prompt.substring(0, 50)}...`,
          abortController: '[AbortController]'
        }, null, 2)}`);

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
                  
                  // Stream update to UI immediately
                  if (options?.onStreamingUpdate) {
                    options.onStreamingUpdate(accumulatedResponse, false);
                  }
                } else if (block.type === 'tool_use') {
                  this.log(`Claude is using tool: ${block.name} with input: ${JSON.stringify(block.input).substring(0, 100)}...`);
                  
                  // Show detailed tool usage information
                  let toolDetails = `**🔧 Using ${block.name}**\n`;
                  
                  if (block.name === 'Bash' && block.input.command) {
                    toolDetails += `Command: \`${block.input.command}\`\n`;
                    if (block.input.description) {
                      toolDetails += `Purpose: ${block.input.description}\n`;
                    }
                  } else if (block.name === 'Read' && block.input.file_path) {
                    toolDetails += `Reading file: \`${block.input.file_path}\`\n`;
                  } else if (block.name === 'Edit' && block.input.file_path) {
                    toolDetails += `Editing file: \`${block.input.file_path}\`\n`;
                    if (block.input.old_string) {
                      toolDetails += `Replacing: \`${block.input.old_string.substring(0, 50)}${block.input.old_string.length > 50 ? '...' : ''}\`\n`;
                    }
                  } else if (block.name === 'Write' && block.input.file_path) {
                    toolDetails += `Writing to: \`${block.input.file_path}\`\n`;
                  } else if (block.name === 'LS' && block.input.path) {
                    toolDetails += `Listing directory: \`${block.input.path}\`\n`;
                  } else if (block.name === 'Grep' && block.input.pattern) {
                    toolDetails += `Searching for: \`${block.input.pattern}\`\n`;
                    if (block.input.path) {
                      toolDetails += `In: \`${block.input.path}\`\n`;
                    }
                  } else {
                    // Generic tool details for other tools
                    const inputStr = JSON.stringify(block.input, null, 2);
                    toolDetails += `Input: \`\`\`json\n${inputStr}\n\`\`\`\n`;
                  }
                  
                  accumulatedResponse += toolDetails + '\n';
                  
                  // Stream tool usage update to UI immediately
                  if (options?.onStreamingUpdate) {
                    options.onStreamingUpdate(accumulatedResponse, false);
                  }
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
          
          // Send final streaming update with completion flag
          if (options?.onStreamingUpdate) {
            options.onStreamingUpdate(accumulatedResponse.trim(), true);
          }
          
          return { suggestion: accumulatedResponse.trim() };
        } else {
          const errorMsg = "No response received from Claude Code SDK";
          
          // Send error as streaming update
          if (options?.onStreamingUpdate) {
            options.onStreamingUpdate(errorMsg, true);
          }
          
          return { suggestion: "", error: errorMsg };
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
    
    // Verify directory exists
    try {
      const fs = require('fs');
      if (!fs.existsSync(workingDir)) {
        this.log(`WARNING: Working directory does not exist: ${workingDir}`);
      } else {
        this.log(`Working directory exists and is accessible: ${workingDir}`);
      }
    } catch (error) {
      this.log(`Error checking working directory: ${error}`);
    }
    
    return workingDir;
  }

  private buildPrompt(request: CompletionRequest): string {
    if (request.language === "text" || !request.context.includes("---")) {
      // This is a chat request, not a code completion
      // Based on GitHub research - add explicit permission context
      return `You are Claude Dev, an AI coding assistant integrated with VSCode. 

IMPORTANT: You have full access to the workspace at ${this.getCurrentWorkingDirectory()}. All tools including Bash, file reading, and editing are explicitly permitted. Do not ask for permissions - proceed directly with any necessary actions.

User request: ${request.prompt}

Workspace context: ${request.context}

Please help with this request by taking any necessary actions directly.`;
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
