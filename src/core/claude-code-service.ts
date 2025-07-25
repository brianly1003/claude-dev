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

  private parseUsageLimitMessage(text: string): string | null {
    // Check if text matches pattern: "Claude AI usage limit reached|<timestamp>"
    const usageLimitPattern = /^Claude AI usage limit reached\|(\d+)$/;
    const match = text.match(usageLimitPattern);
    
    if (!match) {
      return null;
    }
    
    try {
      const timestamp = parseInt(match[1], 10);
      const resetDate = new Date(timestamp * 1000); // Convert from Unix timestamp (seconds) to milliseconds
      
      // Format time in local timezone
      const timeOptions: Intl.DateTimeFormatOptions = {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short'
      };
      
      const formattedTime = resetDate.toLocaleString('en-US', timeOptions);
      
      // Extract just the time part and timezone
      const timeMatch = formattedTime.match(/(\d{1,2}:\d{2}\s*(AM|PM))\s*(.+)/i);
      if (timeMatch) {
        const time = timeMatch[1].toLowerCase().replace(':00', ''); // Remove :00 for clean format like "2am"
        const timezone = timeMatch[3];
        return `Claude usage limit reached. Your limit will reset at ${time} (${timezone}).`;
      } else {
        // Fallback format if parsing fails
        return `Claude usage limit reached. Your limit will reset at ${formattedTime}.`;
      }
    } catch (error) {
      this.log(`Error parsing usage limit timestamp: ${error}`);
      return "Claude usage limit reached. Please try again later.";
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

        // Log the effective command that will be executed for debugging
        const cliPath = this.config.claudeCodePath || 'claude';
        this.log(`Executing Claude Code CLI: ${cliPath} with args: ${JSON.stringify(execArgs)}`);
        this.log(`Working directory: ${this.getCurrentWorkingDirectory()}`);
        this.log(`Subprocess mode: ${queryOptions.useSubprocess}`);

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
                  // Check if this is a usage limit message that needs special formatting
                  const parsedLimitMessage = this.parseUsageLimitMessage(block.text);
                  let textToProcess = parsedLimitMessage || block.text;
                  
                  // Log when we detect and transform a usage limit message
                  if (parsedLimitMessage) {
                    this.log(`Detected usage limit message, transformed to: ${parsedLimitMessage}`);
                  }
                  
                  // Prevent individual text blocks from being too large
                  const truncatedText = textToProcess.length > 5000 ? 
                    textToProcess.substring(0, 5000) + '\n\n[Response truncated to prevent overflow]' : 
                    textToProcess;
                  
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
                    // For Edit tool, include the full tool call JSON so frontend can render diff
                    const toolCall = {
                      type: 'tool_use',
                      id: block.id,
                      name: block.name,
                      input: block.input
                    };
                    toolDetails = `[${JSON.stringify(toolCall)}]\n`;
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
            
            // Check if this is an error result with usage limit information
            const resultMessage = message as any;
            if (resultMessage.is_error && resultMessage.result) {
              const parsedLimitMessage = this.parseUsageLimitMessage(resultMessage.result);
              if (parsedLimitMessage) {
                this.log(`Detected usage limit in result message: ${parsedLimitMessage}`);
                
                // Send usage limit message as streaming update and return error
                if (options?.onStreamingUpdate && !this.currentAbortController?.signal.aborted) {
                  options.onStreamingUpdate(parsedLimitMessage, true);
                }
                
                clearTimeout(timeout);
                this.currentAbortController = null;
                return { suggestion: "", error: parsedLimitMessage };
              }
            }
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
      this.log(`Full error object: ${JSON.stringify(error, null, 2)}`);
      
      // Enhanced error handling for common Claude Code CLI issues
      let enhancedErrorMessage = `Claude Code SDK error: ${error.message}`;
      
      // Check for specific error patterns and provide better user messages
      if (error.message && error.message.includes('process exited with code 1')) {
        this.log(`Claude Code CLI exited with code 1 - this typically indicates API authentication or usage limit issues`);
        enhancedErrorMessage = `Claude usage limit reached or authentication issue. Please check your API key and usage limits.`;
      } else if (error.message && error.message.includes('process exited with code 2')) {
        enhancedErrorMessage = `Claude Code CLI configuration error. Please check your setup.`;
      } else if (error.message && error.message.includes('ENOENT') || error.message.includes('command not found')) {
        enhancedErrorMessage = `Claude Code CLI not found. Please install or configure the claude binary path.`;
      } else if (error.message && error.message.includes('timeout')) {
        enhancedErrorMessage = `Request timed out. Please try again.`;
      } else if (error.message && error.message.includes('network') || error.message.includes('ECONNREFUSED')) {
        enhancedErrorMessage = `Network connection error. Please check your internet connection.`;
      }
      
      this.log(`Enhanced error message: ${enhancedErrorMessage}`);
      return { suggestion: "", error: enhancedErrorMessage };
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