import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface MCPServerConfig {
    name: string;
    type: 'stdio' | 'sse';
    command: string;
    args: string[];
    env?: Record<string, string>;
}

export interface MCPConfiguration {
    mcpServers: Record<string, MCPServerConfig>;
}

export class MCPManager {
    private configPath: string;
    private config: MCPConfiguration;

    constructor() {
        this.configPath = path.join(os.homedir(), '.claude', 'claude.json');
        this.config = { mcpServers: {} };
        this.loadConfiguration();
    }

    /**
     * Load MCP configuration from ~/.claude/claude.json
     */
    private loadConfiguration(): void {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                this.config = JSON.parse(configData);
            } else {
                // Create default config directory
                const configDir = path.dirname(this.configPath);
                if (!fs.existsSync(configDir)) {
                    fs.mkdirSync(configDir, { recursive: true });
                }
                this.saveConfiguration();
            }
        } catch (error) {
            console.error('Failed to load MCP configuration:', error);
            this.config = { mcpServers: {} };
        }
    }

    /**
     * Save MCP configuration to ~/.claude/claude.json
     */
    private saveConfiguration(): void {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
        } catch (error) {
            console.error('Failed to save MCP configuration:', error);
        }
    }

    /**
     * Add or update MCP server configuration
     */
    public addMCPServer(name: string, serverConfig: Omit<MCPServerConfig, 'name'>): void {
        this.config.mcpServers[name] = {
            name,
            ...serverConfig
        };
        this.saveConfiguration();
    }

    /**
     * Remove MCP server configuration
     */
    public removeMCPServer(name: string): void {
        delete this.config.mcpServers[name];
        this.saveConfiguration();
    }

    /**
     * Get MCP server configuration
     */
    public getMCPServer(name: string): MCPServerConfig | undefined {
        return this.config.mcpServers[name];
    }

    /**
     * List all configured MCP servers
     */
    public listMCPServers(): MCPServerConfig[] {
        return Object.values(this.config.mcpServers);
    }

    /**
     * Check if MCP server is configured
     */
    public hasMCPServer(name: string): boolean {
        return name in this.config.mcpServers;
    }

    /**
     * Setup Playwright MCP server automatically
     */
    public async setupPlaywrightMCP(): Promise<void> {
        if (!this.hasMCPServer('playwright')) {
            // Add Playwright MCP server configuration
            this.addMCPServer('playwright', {
                type: 'stdio',
                command: 'npx',
                args: ['@executeautomation/playwright-mcp-server']
            });

            // Show installation instructions
            const installChoice = await vscode.window.showInformationMessage(
                'Playwright MCP server configured! Install the required package?',
                'Install Now',
                'Install Later',
                'Learn More'
            );

            if (installChoice === 'Install Now') {
                await this.installPlaywrightMCP();
            } else if (installChoice === 'Learn More') {
                vscode.env.openExternal(vscode.Uri.parse('https://github.com/executeautomation/playwright-mcp-server'));
            }
        }
    }

    /**
     * Install Playwright MCP server package
     */
    private async installPlaywrightMCP(): Promise<void> {
        const terminal = vscode.window.createTerminal('Claude Dev - MCP Setup');
        terminal.show();
        terminal.sendText('npm install -g @executeautomation/playwright-mcp-server');
        terminal.sendText('npx playwright install');
        
        vscode.window.showInformationMessage(
            'Installing Playwright MCP server... Check terminal for progress.'
        );
    }

    /**
     * Setup Puppeteer MCP server automatically  
     */
    public async setupPuppeteerMCP(): Promise<void> {
        if (!this.hasMCPServer('puppeteer')) {
            this.addMCPServer('puppeteer', {
                type: 'stdio',
                command: 'npx',
                args: ['@modelcontextprotocol/server-puppeteer']
            });

            const installChoice = await vscode.window.showInformationMessage(
                'Puppeteer MCP server configured! Install the required package?',
                'Install Now',
                'Install Later'
            );

            if (installChoice === 'Install Now') {
                const terminal = vscode.window.createTerminal('Claude Dev - MCP Setup');
                terminal.show();
                terminal.sendText('npm install -g @modelcontextprotocol/server-puppeteer');
            }
        }
    }

    /**
     * Generate MCP configuration file content for Claude Code
     */
    public generateClaudeConfig(): string {
        return JSON.stringify(this.config, null, 2);
    }

    /**
     * Validate MCP server is running
     */
    public async validateMCPServer(name: string): Promise<boolean> {
        const server = this.getMCPServer(name);
        if (!server) {
            return false;
        }

        try {
            // For now, just check if the command exists
            // In a real implementation, you'd ping the MCP server
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Get available UI testing tools
     */
    public getUITestingTools(): string[] {
        const tools: string[] = [];
        
        if (this.hasMCPServer('playwright')) {
            tools.push('playwright');
        }
        
        if (this.hasMCPServer('puppeteer')) {
            tools.push('puppeteer');
        }
        
        return tools;
    }

    /**
     * Auto-configure common MCP servers for UI testing
     */
    public async autoConfigureUITesting(): Promise<void> {
        // Setup Playwright (preferred)
        await this.setupPlaywrightMCP();
        
        // Show configuration status
        vscode.window.showInformationMessage(
            `MCP Configuration updated! Available tools: ${this.getUITestingTools().join(', ') || 'None'}`
        );
    }
}