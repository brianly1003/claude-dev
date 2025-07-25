import { query, type SDKMessage } from "@anthropic-ai/claude-code";
import * as vscode from "vscode";

export interface ClaudeCodeConfig {
  claudeCodePath?: string; // Optional now since SDK can auto-detect
  enableLogging: boolean;
  workspaceRoot?: string;
  yoloMode?: boolean; // Enable automatic permission approval
  model?: string; // Claude model: default, opus, sonnet
  thinkingMode?: string; // Thinking intensity: none, think, think-hard, think-harder, ultrathink
}

export interface CompletionRequest {
  prompt: string;
  context: string;
  language: string;
}

export interface CompletionResponse {
  suggestion: string;
  error?: string;
  thinkingContent?: string;
}

export interface StreamingCompletionOptions {
  onStreamingUpdate?: (partialResponse: string, isComplete: boolean, messageType?: string, thinkingContent?: string) => void;
}

export class ClaudeCodeService {
  private config: ClaudeCodeConfig;
  private outputChannel: vscode.OutputChannel;
  private currentAbortController: AbortController | null = null;

  constructor(config: ClaudeCodeConfig) {
    this.config = config;
    this.outputChannel = vscode.window.createOutputChannel("Claude Dev");
  }

  public updateConfig(config: ClaudeCodeConfig): void {
    this.config = config;
  }

  public stopGeneration(): void {
    if (this.currentAbortController) {
      this.log('Stopping generation on user request - aborting current request');
      this.currentAbortController.abort();
      this.log('Abort signal sent, setting controller to null');
      this.currentAbortController = null;
    } else {
      this.log('No active generation to stop - no abort controller found');
    }
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
        this.log(`YOLO Mode enabled - SECURE: --add-dir ${this.getCurrentWorkingDirectory()}, --permission-mode allowPermissions, --allowedTools [workspace-safe tools only]`);
      } else {
        this.log(`YOLO Mode disabled - user will be prompted for all permissions`);
      }

      this.currentAbortController = new AbortController();
      const timeout = setTimeout(() => {
        this.log(`Aborting multi-turn conversation after 180 seconds`);
        this.currentAbortController?.abort();
      }, 180000); // 3 minutes for multi-turn conversations

      try {
        const execArgs = [];
        const workspaceDir = this.getCurrentWorkingDirectory();
        
        // SECURITY: Only allow access to the workspace directory
        execArgs.push('--add-dir');
        execArgs.push(workspaceDir);
        
        // SECURITY: Restrict tools to workspace-safe operations only
        execArgs.push('--allowedTools');
        execArgs.push('LS,Read,Edit,Write,Glob,Grep,MultiEdit,NotebookRead,NotebookEdit');
        
        // SECURITY: Do NOT use dangerously-skip-permissions or bypassPermissions
        // This ensures Claude Code will prompt for file operations outside workspace
        
        if (this.config.yoloMode !== false) {
          // Only enable limited auto-permissions for workspace operations
          execArgs.push('--permission-mode');
          execArgs.push('allowPermissions');
          execArgs.push('--verbose');
        }
        
        // Add model selection
        if (this.config.model && this.config.model !== 'default') {
          execArgs.push('--model');
          execArgs.push(this.config.model);
        }
        
        // Add thinking mode
        if (this.config.thinkingMode && this.config.thinkingMode !== 'none') {
          execArgs.push('--thinking');
          execArgs.push(this.config.thinkingMode);
        }
        
        const queryOptions: any = {
          prompt: prompt,
          abortController: this.currentAbortController,
          options: {
            // SECURITY: Only allow workspace-safe tools, NO Bash or Task tools
            allowedTools: ['LS', 'Read', 'Edit', 'Write', 'Glob', 'Grep', 'MultiEdit', 'NotebookRead', 'NotebookEdit'],
            useCommitSigning: false,
          },
          cwd: this.getCurrentWorkingDirectory(),
          // Pass CLI arguments through executableArgs
          executableArgs: execArgs,
          // SECURITY: Remove dangerous permission bypasses
          // dangerouslySkipPermissions: false (default)
          // permissionMode: 'default' (will prompt for external access)
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

        let turnCount = 0;
        const maxResponseLength = 50000; // Limit response length
        let thinkingContent = ''; // Store thinking content separately
        
        try {
          for await (const message of query(queryOptions)) {
          // Check if request was aborted
          if (this.currentAbortController?.signal.aborted) {
            this.log(`Request was aborted, stopping message processing`);
            break;
          }
          
          messages.push(message);
          turnCount++;
          
          this.log(`Turn ${turnCount}: Received message type: ${message.type}`);
          
          // Check for response length overflow
          if (accumulatedResponse.length > maxResponseLength) {
            this.log(`Response length exceeded ${maxResponseLength} chars, stopping`);
            break;
          }
          
          if (message.type === 'assistant' && message.message) {
            const assistantMessage = message.message;
            
            if (assistantMessage.content && Array.isArray(assistantMessage.content)) {
              for (const block of assistantMessage.content) {
                if (block.type === 'thinking') {
                  // Accumulate thinking content
                  const thinking = block.thinking || 'processing...';
                  thinkingContent += thinking + '\n\n';
                  this.log(`Claude is thinking: ${thinking.substring(0, 100)}...`);
                  
                  if (options?.onStreamingUpdate && !this.currentAbortController?.signal.aborted) {
                    // Send thinking update to UI with accumulated content
                    options.onStreamingUpdate(thinkingContent, false, 'thinking');
                  }
                } else if (block.type === 'text' && block.text) {
                  // Prevent individual text blocks from being too large
                  const truncatedText = block.text.length > 5000 ? 
                    block.text.substring(0, 5000) + '\n\n[Response truncated to prevent overflow]' : 
                    block.text;
                  
                  accumulatedResponse += truncatedText + '\n\n';
                  
                  // Stream update to UI immediately
                  if (options?.onStreamingUpdate && !this.currentAbortController?.signal.aborted) {
                    options.onStreamingUpdate(accumulatedResponse, false);
                  }
                } else if (block.type === 'tool_use') {
                  this.log(`Claude is using tool: ${block.name} with input: ${JSON.stringify(block.input).substring(0, 100)}...`);
                  
                  // Format tool usage like claude-code: ● ToolName(description)
                  let toolDetails = '';
                  
                  if (block.name === 'Bash' && block.input.command) {
                    toolDetails = `● Bash(${block.input.command})\n`;
                  } else if (block.name === 'Read' && block.input.file_path) {
                    toolDetails = `● Read(${block.input.file_path})\n`;
                  } else if (block.name === 'Edit' && block.input.file_path) {
                    toolDetails = `● Edit(${block.input.file_path})\n`;
                  } else if (block.name === 'Write' && block.input.file_path) {
                    toolDetails = `● Write(${block.input.file_path})\n`;
                  } else if (block.name === 'LS' && block.input.path) {
                    toolDetails = `● LS(${block.input.path})\n`;
                  } else if (block.name === 'Grep' && block.input.pattern) {
                    const searchIn = block.input.path ? ` in ${block.input.path}` : '';
                    toolDetails = `● Grep(${block.input.pattern}${searchIn})\n`;
                  } else if (block.name === 'Glob' && block.input.pattern) {
                    const searchIn = block.input.path ? ` in ${block.input.path}` : '';
                    toolDetails = `● Glob(${block.input.pattern}${searchIn})\n`;
                  } else if (block.name === 'Task' && block.input.description) {
                    toolDetails = `● Task(${block.input.description})\n`;
                  } else if (block.name === 'TodoWrite') {
                    toolDetails = `● TodoWrite(Update task list)\n`;
                  } else {
                    // Generic format for other tools
                    const description = block.input.description || 
                                      block.input.command || 
                                      block.input.file_path || 
                                      block.input.pattern || 
                                      Object.keys(block.input)[0] || 
                                      'operation';
                    toolDetails = `● ${block.name}(${description})\n`;
                  }
                  
                  accumulatedResponse += toolDetails;
                  
                  // Stream tool usage update to UI immediately
                  if (options?.onStreamingUpdate && !this.currentAbortController?.signal.aborted) {
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
        } catch (queryError: any) {
          this.log(`Query error during streaming: ${queryError.message}`);
          const wasAborted = this.currentAbortController?.signal.aborted;
          if (queryError.name === 'AbortError' || wasAborted) {
            this.log(`Query was properly aborted`);
            return { suggestion: accumulatedResponse || "", error: "Request was cancelled by user" };
          }
          // Re-throw other errors
          throw queryError;
        }

        clearTimeout(timeout);
        const wasAborted = this.currentAbortController?.signal.aborted;
        this.currentAbortController = null;

        if (accumulatedResponse.trim()) {
          this.log(`Final response: ${accumulatedResponse.substring(0, 100)}...`);
          this.log(`Thinking content: ${thinkingContent.length} characters`);
          
          // Send final streaming update with completion flag and thinking content
          if (options?.onStreamingUpdate && !wasAborted) {
            options.onStreamingUpdate(accumulatedResponse.trim(), true, 'complete', thinkingContent);
          }
          
          return { 
            suggestion: accumulatedResponse.trim(),
            thinkingContent: thinkingContent.trim()
          };
        } else {
          const errorMsg = "No response received from Claude Code SDK";
          
          // Send error as streaming update
          if (options?.onStreamingUpdate && !wasAborted) {
            options.onStreamingUpdate(errorMsg, true);
          }
          
          return { suggestion: "", error: errorMsg };
        }

      } catch (error: any) {
        clearTimeout(timeout);
        const wasAborted = this.currentAbortController?.signal.aborted;
        this.currentAbortController = null;
        if (error.name === 'AbortError' || wasAborted) {
          this.log(`Request was aborted`);
          return { suggestion: accumulatedResponse || "", error: "Request timeout - partial response may be available" };
        }
        throw error;
      } finally {
        clearTimeout(timeout);
        this.currentAbortController = null;
        // Force garbage collection to free memory
        if (global.gc) {
          global.gc();
        }
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

IMPORTANT SECURITY CONSTRAINTS:
- You can ONLY access files within the current workspace: ${this.getCurrentWorkingDirectory()}
- You can read, edit, search, and list files within this workspace
- You CANNOT access files outside this workspace directory  
- You CANNOT run bash commands or access system files
- All operations must stay within the project boundaries

User request: ${request.prompt}

Workspace context: ${request.context}

Please help with this request using only workspace-safe file operations.`;
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
