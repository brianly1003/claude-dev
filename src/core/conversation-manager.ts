import * as vscode from 'vscode';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ConversationMetadata {
  id: string;
  title: string;
  startTime: number;
  lastActivity: number;
  messageCount: number;
  workspaceRoot?: string;
  totalTokens?: number;
  estimatedCost?: number;
}

export interface Conversation {
  metadata: ConversationMetadata;
  messages: ChatMessage[];
}

export class ConversationManager {
  private storageUri: vscode.Uri;
  private currentConversation: Conversation | null = null;
  private conversationIndex: ConversationMetadata[] = [];
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
    this.storageUri = vscode.Uri.joinPath(context.globalStorageUri, 'conversations');
    this.ensureStorageDirectory();
    this.loadConversationIndex().then(() => {
      // Clean up any stale entries after loading
      this.validateAndCleanIndex();
    });
  }

  private async ensureStorageDirectory(): Promise<void> {
    try {
      await vscode.workspace.fs.createDirectory(this.storageUri);
    } catch (error) {
      // Directory might already exist, ignore error
    }
  }

  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  public startNewConversation(title?: string): string {
    const conversationId = this.generateId();
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    
    this.currentConversation = {
      metadata: {
        id: conversationId,
        title: title || `Chat ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        startTime: Date.now(),
        lastActivity: Date.now(),
        messageCount: 0,
        workspaceRoot
      },
      messages: []
    };

    this.updateConversationIndex();
    return conversationId;
  }

  public addMessage(role: 'user' | 'assistant', content: string): ChatMessage {
    if (!this.currentConversation) {
      this.startNewConversation();
    }

    const message: ChatMessage = {
      id: this.generateMessageId(),
      role,
      content,
      timestamp: Date.now()
    };

    this.currentConversation!.messages.push(message);
    this.currentConversation!.metadata.messageCount++;
    this.currentConversation!.metadata.lastActivity = Date.now();

    // Auto-save after each message
    this.saveCurrentConversation();
    this.updateConversationIndex();

    return message;
  }

  public getCurrentConversation(): Conversation | null {
    return this.currentConversation;
  }

  public updateConversationMetrics(tokens: number, cost: number): void {
    if (this.currentConversation) {
      this.currentConversation.metadata.totalTokens = tokens;
      this.currentConversation.metadata.estimatedCost = cost;
      this.saveCurrentConversation();
      this.updateConversationIndex();
    }
  }

  public async loadConversation(conversationId: string): Promise<Conversation | null> {
    try {
      const conversationFile = vscode.Uri.joinPath(this.storageUri, `${conversationId}.json`);
      const data = await vscode.workspace.fs.readFile(conversationFile);
      const conversation: Conversation = JSON.parse(data.toString());
      
      // Ensure timestamps are numbers (in case of old data format)
      if (typeof conversation.metadata.startTime === 'string') {
        conversation.metadata.startTime = new Date(conversation.metadata.startTime).getTime();
      }
      if (typeof conversation.metadata.lastActivity === 'string') {
        conversation.metadata.lastActivity = new Date(conversation.metadata.lastActivity).getTime();
      }
      conversation.messages.forEach(msg => {
        if (typeof msg.timestamp === 'string') {
          msg.timestamp = new Date(msg.timestamp).getTime();
        }
      });

      this.currentConversation = conversation;
      return conversation;
    } catch (error) {
      console.error(`Failed to load conversation ${conversationId}:`, error);
      
      // If the file doesn't exist, clean up the stale entry from index
      if (error && (error as any).code === 'FileNotFound') {
        console.warn(`Conversation file not found: ${conversationId}, cleaning up from index`);
        await this.removeStaleConversation(conversationId);
      }
      
      return null;
    }
  }

  private async saveCurrentConversation(): Promise<void> {
    if (!this.currentConversation) return;

    try {
      const conversationFile = vscode.Uri.joinPath(this.storageUri, `${this.currentConversation.metadata.id}.json`);
      const data = JSON.stringify(this.currentConversation, null, 2);
      await vscode.workspace.fs.writeFile(conversationFile, Buffer.from(data));
    } catch (error) {
      console.error('Failed to save conversation:', error);
    }
  }

  private async loadConversationIndex(): Promise<void> {
    try {
      const indexFile = vscode.Uri.joinPath(this.storageUri, 'index.json');
      const data = await vscode.workspace.fs.readFile(indexFile);
      const index = JSON.parse(data.toString());
      
      // Ensure timestamps are numbers (in case of old data format)
      this.conversationIndex = index.map((metadata: any) => ({
        ...metadata,
        startTime: typeof metadata.startTime === 'string' 
          ? new Date(metadata.startTime).getTime() 
          : metadata.startTime,
        lastActivity: typeof metadata.lastActivity === 'string'
          ? new Date(metadata.lastActivity).getTime()
          : metadata.lastActivity
      }));

      // Sort by last activity (most recent first)
      this.conversationIndex.sort((a, b) => b.lastActivity - a.lastActivity);
      
      // Limit to 50 most recent conversations
      this.conversationIndex = this.conversationIndex.slice(0, 50);
    } catch (error) {
      // Index file might not exist yet, start with empty array
      this.conversationIndex = [];
    }
  }

  private async updateConversationIndex(): Promise<void> {
    if (!this.currentConversation) return;

    // Update or add current conversation to index
    const existingIndex = this.conversationIndex.findIndex(
      conv => conv.id === this.currentConversation!.metadata.id
    );

    if (existingIndex >= 0) {
      this.conversationIndex[existingIndex] = this.currentConversation.metadata;
    } else {
      this.conversationIndex.unshift(this.currentConversation.metadata);
    }

    // Sort by last activity and limit to 50
    this.conversationIndex.sort((a, b) => b.lastActivity - a.lastActivity);
    this.conversationIndex = this.conversationIndex.slice(0, 50);

    try {
      const indexFile = vscode.Uri.joinPath(this.storageUri, 'index.json');
      const data = JSON.stringify(this.conversationIndex, null, 2);
      await vscode.workspace.fs.writeFile(indexFile, Buffer.from(data));
    } catch (error) {
      console.error('Failed to update conversation index:', error);
    }
  }

  public getConversationList(): ConversationMetadata[] {
    return [...this.conversationIndex];
  }

  public async deleteConversation(conversationId: string): Promise<void> {
    try {
      // Remove from file system
      const conversationFile = vscode.Uri.joinPath(this.storageUri, `${conversationId}.json`);
      await vscode.workspace.fs.delete(conversationFile);

      // Remove from index
      this.conversationIndex = this.conversationIndex.filter(conv => conv.id !== conversationId);
      await this.updateConversationIndex();

      // Clear current conversation if it was deleted
      if (this.currentConversation?.metadata.id === conversationId) {
        this.currentConversation = null;
      }
    } catch (error) {
      console.error(`Failed to delete conversation ${conversationId}:`, error);
    }
  }

  public async clearAllConversations(): Promise<void> {
    try {
      // Delete all conversation files
      for (const conversation of this.conversationIndex) {
        try {
          const conversationFile = vscode.Uri.joinPath(this.storageUri, `${conversation.id}.json`);
          await vscode.workspace.fs.delete(conversationFile);
        } catch (error) {
          console.warn(`Failed to delete conversation file ${conversation.id}:`, error);
        }
      }

      // Clear the index
      this.conversationIndex = [];
      await this.updateConversationIndex();

      // Clear current conversation
      this.currentConversation = null;
    } catch (error) {
      console.error('Failed to clear all conversations:', error);
      throw error;
    }
  }

  public async removeStaleConversation(conversationId: string): Promise<void> {
    try {
      // Remove from index only (file is already gone)
      const initialLength = this.conversationIndex.length;
      this.conversationIndex = this.conversationIndex.filter(conv => conv.id !== conversationId);
      
      // Only update if we actually removed something
      if (this.conversationIndex.length < initialLength) {
        await this.updateConversationIndex();
        console.log(`Removed stale conversation from index: ${conversationId}`);
      }

      // Clear current conversation if it was the stale one
      if (this.currentConversation?.metadata.id === conversationId) {
        this.currentConversation = null;
      }
    } catch (error) {
      console.error(`Failed to remove stale conversation ${conversationId} from index:`, error);
    }
  }

  public clearHistory(): void {
    this.currentConversation = null;
  }

  public async validateAndCleanIndex(): Promise<void> {
    try {
      const validConversations = [];
      
      for (const conv of this.conversationIndex) {
        try {
          // Check if the conversation file exists
          const conversationFile = vscode.Uri.joinPath(this.storageUri, `${conv.id}.json`);
          await vscode.workspace.fs.stat(conversationFile);
          validConversations.push(conv);
        } catch (error) {
          // File doesn't exist, skip this conversation
          console.warn(`Removing stale conversation from index: ${conv.id}`);
        }
      }

      // Update the index if we found stale entries
      if (validConversations.length !== this.conversationIndex.length) {
        this.conversationIndex = validConversations;
        await this.updateConversationIndex();
        console.log(`Cleaned up ${this.conversationIndex.length - validConversations.length} stale conversation entries`);
      }
    } catch (error) {
      console.error('Failed to validate conversation index:', error);
    }
  }

  public async loadMostRecentConversation(): Promise<Conversation | null> {
    if (this.conversationIndex.length > 0) {
      const mostRecent = this.conversationIndex[0];
      return await this.loadConversation(mostRecent.id);
    }
    return null;
  }

  // Get conversation history as context for Claude
  public getConversationContext(): string {
    if (!this.currentConversation || this.currentConversation.messages.length === 0) {
      return "";
    }

    // Only last 3 messages with heavy truncation
    const recentMessages = this.currentConversation.messages.slice(-3);
    let context = "";
    
    for (const message of recentMessages) {
      const role = message.role === 'user' ? 'U' : 'A';
      // Heavily truncate to 100 chars
      context += `${role}: ${message.content.substring(0, 100)}${message.content.length > 100 ? '...' : ''}\n`;
    }

    return context;
  }

  // Get VSCode extension context for global state access
  public getContext(): vscode.ExtensionContext {
    return this.context;
  }

}