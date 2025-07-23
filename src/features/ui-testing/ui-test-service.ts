import { ClaudeCodeService } from '../../core/claude-code-service';
import { MCPManager } from '../mcp/mcp-manager';

export interface UITestScenario {
    name: string;
    url: string;
    description: string;
    expectedElements?: string[];
    testFlow?: string[];
    actions?: UITestAction[];
    assertions?: UITestAssertion[];
}

export interface UITestAction {
    type: 'click' | 'fill' | 'navigate' | 'wait' | 'scroll';
    selector?: string;
    value?: string;
    timeout?: number;
}

export interface UITestAssertion {
    type: 'exists' | 'text' | 'url' | 'title' | 'attribute';
    selector?: string;
    expected: string;
    attribute?: string;
}

export interface UITestResult {
    success: boolean;
    message: string;
    screenshots?: string[];
    error?: string;
}

/**
 * Consolidated UI Testing Service
 * Combines MCP integration with test generation and execution
 */
export class UITestService {
    private claudeService: ClaudeCodeService;
    private mcpManager: MCPManager;

    constructor(claudeService: ClaudeCodeService) {
        this.claudeService = claudeService;
        this.mcpManager = new MCPManager();
    }

    /**
     * Auto-configure MCP servers for UI testing
     */
    public async autoConfigureMCP(): Promise<void> {
        await this.mcpManager.autoConfigureUITesting();
    }

    /**
     * Get MCP configuration status
     */
    public getMCPStatus(): { configured: boolean; tools: string[]; configPath: string } {
        this.mcpManager.reloadConfiguration();
        const servers = this.mcpManager.listMCPServers();
        const tools = servers.map(server => server.name);
        
        return {
            configured: tools.length > 0,
            tools: tools,
            configPath: '~/.claude/claude.json'
        };
    }

    /**
     * Get detailed MCP server configurations
     */
    public getDetailedMCPServers(): any[] {
        this.mcpManager.reloadConfiguration();
        const servers = this.mcpManager.listMCPServers();
        
        return servers.map(server => ({
            name: server.name,
            displayName: server.displayName || server.name,
            type: server.type,
            command: server.command,
            args: server.args || [],
            env: server.env || {}
        }));
    }

    /**
     * Create UI test scenario from natural language
     */
    public async createTestScenario(prompt: string): Promise<UITestScenario> {
        // Extract URL from prompt
        const urlMatch = prompt.match(/https?:\/\/[^\s]+|localhost:\d+/);
        const url = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : `http://${urlMatch[0]}`) : 'http://localhost:3000';
        
        let scenario: UITestScenario;

        if (prompt.toLowerCase().includes('login')) {
            scenario = {
                name: 'login_flow_test',
                url: url,
                description: 'Test user login functionality',
                expectedElements: ['#username', '#password', 'button[type="submit"]', '.dashboard'],
                testFlow: [
                    'Navigate to login page',
                    'Fill username field',
                    'Fill password field', 
                    'Click submit button',
                    'Verify dashboard loads'
                ],
                actions: [
                    { type: 'fill', selector: '#username', value: 'testuser' },
                    { type: 'fill', selector: '#password', value: 'password123' },
                    { type: 'click', selector: 'button[type="submit"]' }
                ],
                assertions: [
                    { type: 'title', expected: 'Dashboard' },
                    { type: 'url', expected: `${url}/dashboard` }
                ]
            };
        } else if (prompt.toLowerCase().includes('form')) {
            scenario = {
                name: 'form_validation_test',
                url: url,
                description: 'Test form validation and submission',
                expectedElements: ['form', 'input[type="text"]', 'input[type="email"]', 'button[type="submit"]'],
                testFlow: [
                    'Navigate to form page',
                    'Fill form fields',
                    'Submit form',
                    'Verify success message'
                ],
                actions: [
                    { type: 'fill', selector: 'input[type="text"]', value: 'test input' },
                    { type: 'fill', selector: 'input[type="email"]', value: 'test@example.com' },
                    { type: 'click', selector: 'button[type="submit"]' }
                ],
                assertions: [
                    { type: 'exists', selector: '.success-message', expected: 'exists' }
                ]
            };
        } else if (prompt.toLowerCase().includes('navigation')) {
            scenario = {
                name: 'navigation_test',
                url: url,
                description: 'Test page navigation and links',
                expectedElements: ['nav', 'a[href]', '.menu', '.content'],
                testFlow: [
                    'Load main page',
                    'Click navigation links',
                    'Verify page content loads',
                    'Check all links work'
                ],
                actions: [
                    { type: 'wait', timeout: 1000 }
                ],
                assertions: [
                    { type: 'exists', selector: 'nav', expected: 'exists' },
                    { type: 'title', expected: 'Navigation Test' }
                ]
            };
        } else {
            // Generic test
            scenario = {
                name: 'generic_ui_test',
                url: url,
                description: 'General UI functionality test',
                expectedElements: ['body', 'header', 'main', 'footer'],
                testFlow: [
                    'Load the page',
                    'Take screenshot',
                    'Verify basic elements exist',
                    'Check page responsiveness'
                ],
                actions: [
                    { type: 'wait', timeout: 1000 }
                ],
                assertions: [
                    { type: 'exists', selector: 'body', expected: 'exists' },
                    { type: 'title', expected: 'Page Title' }
                ]
            };
        }

        return scenario;
    }

    /**
     * Execute UI test using MCP tools through Claude
     */
    public async executeUITest(scenario: UITestScenario): Promise<UITestResult> {
        const availableTools = this.mcpManager.getUITestingTools();
        
        if (availableTools.length === 0) {
            return {
                success: false,
                message: `❌ **MCP Tools Not Configured**

To run UI tests, you need to configure MCP servers. Would you like me to set this up automatically?

**Available options:**
- Playwright MCP Server (Recommended)
- Puppeteer MCP Server

Run: \`Configure MCP for UI testing\` to get started.`,
                error: 'No MCP tools configured'
            };
        }

        // Generate enhanced system prompt for Claude with MCP context
        const systemPrompt = `You are a UI testing expert with access to MCP tools for browser automation.

**Available MCP Tools:** ${availableTools.join(', ')}

**Test Scenario:**
- Name: ${scenario.name}
- URL: ${scenario.url}  
- Description: ${scenario.description}

**Expected Elements:** ${scenario.expectedElements?.join(', ') || 'Auto-detect'}

**Test Flow:**
${scenario.testFlow?.map((step, i) => `${i + 1}. ${step}`).join('\n') || 'Auto-generate test steps'}

**Instructions:**
1. Use MCP browser automation tools to navigate to the URL
2. Perform the test actions step by step
3. Take screenshots at key points
4. Validate expected elements exist
5. Report detailed results with pass/fail status
6. If elements are missing, suggest alternative selectors

Execute this test using available MCP tools and provide comprehensive results.`;

        const testPrompt = `Execute UI test for: ${scenario.name}

Target URL: ${scenario.url}
Test Description: ${scenario.description}

Please use MCP browser automation tools to:
1. Navigate to the target URL
2. Perform the test actions
3. Take screenshots
4. Validate results
5. Provide detailed test report

Start the test execution now.`;

        try {
            const response = await this.claudeService.getCompletion({
                prompt: testPrompt,
                context: systemPrompt,
                language: 'text'
            });

            if (response.error) {
                return {
                    success: false,
                    message: `❌ **UI Test Execution Failed**

Error: ${response.error}

**Troubleshooting:**
1. Verify MCP servers are running: ${availableTools.join(', ')}
2. Check if target URL is accessible: ${scenario.url}
3. Ensure Claude Code has permission to use MCP tools`,
                    error: response.error
                };
            }

            return {
                success: true,
                message: `## 🎭 UI Test Execution Results

**Test:** ${scenario.name}
**URL:** ${scenario.url}
**Tools Used:** ${availableTools.join(', ')}

### 📋 Test Scenario
${scenario.description}

### 🔧 Execution Details
${response.suggestion}

### 📝 MCP Configuration
Your MCP servers are configured at: \`~/.claude/claude.json\`

\`\`\`json
${this.mcpManager.generateClaudeConfig()}
\`\`\`

🎯 **Pro Tip:** You can modify test scenarios by saying things like:
- "Test the checkout process"
- "Validate form errors on empty submission"  
- "Check mobile responsiveness"`
            };

        } catch (error) {
            return {
                success: false,
                message: `❌ **UI Test Execution Failed**

Error: ${error}

**Troubleshooting:**
1. Verify MCP servers are running: ${availableTools.join(', ')}
2. Check if target URL is accessible: ${scenario.url}
3. Ensure Claude Code has permission to use MCP tools

**Debug Commands:**
- Check MCP status: \`List MCP servers\`
- Reconfigure tools: \`Configure MCP for UI testing\`
- Test connection: \`Test MCP connection\``,
                error: String(error)
            };
        }
    }

    /**
     * Handle browser automation through Puppeteer MCP
     */
    public async executeBrowserAutomation(message: string): Promise<UITestResult> {
        this.mcpManager.reloadConfiguration();
        const servers = this.mcpManager.listMCPServers();
        const puppeteerServer = servers.find(server => 
            server.name.toLowerCase().includes('puppeteer') || 
            server.command.includes('puppeteer')
        );

        if (!puppeteerServer) {
            return {
                success: false,
                message: `## ❌ Puppeteer MCP Server Not Found

**The Puppeteer MCP server is not configured.** Please install and configure it first.

### 🔧 **Quick Setup:**
1. Open the MCP Servers modal (click the MCP button in the header)
2. Click on "Puppeteer" in the Popular MCP Servers section
3. Or run: \`Configure MCP for UI testing\`

### 📋 **Currently Configured Servers:**
${servers.length > 0 ? 
    servers.map(server => `- **${server.name}**: ${server.command}`).join('\n') : 
    'None configured'
}`,
                error: 'Puppeteer MCP server not configured'
            };
        }

        // Extract URL from message or use default
        const projectUrl = this.detectProjectUrl(message);
        
        // Create browser automation scenario
        const scenario = this.createBrowserAutomationScenario(message, projectUrl);
        
        // Execute automation through Claude with MCP tools
        const automationPrompt = `Using Puppeteer MCP tools: ${scenario.description}. Actions: ${scenario.actions.join(', ')}. Target: ${projectUrl}. Focus only on browser automation.`;

        try {
            const response = await this.claudeService.getCompletion({
                prompt: automationPrompt,
                context: `BROWSER AUTOMATION: Use Puppeteer MCP server ${puppeteerServer.name} to view ${projectUrl}. Only use browser tools.`,
                language: 'text'
            });

            return {
                success: true,
                message: `## 🎭 Puppeteer Browser Automation Results

**📍 Target URL:** ${projectUrl}
**🛠️ MCP Server:** ${puppeteerServer.name}

### 🤖 Automation Results:
${response.suggestion || 'Browser automation completed successfully.'}

### 📊 Configuration:
- **Server:** \`${puppeteerServer.command} ${puppeteerServer.args?.join(' ') || ''}\`
- **Type:** ${puppeteerServer.type}
- **URL:** ${projectUrl}`
            };

        } catch (error) {
            return {
                success: false,
                message: `## ❌ Browser Automation Error

**Error:** ${error}

### 🔧 **Troubleshooting:**
1. **Verify URL is accessible:** ${projectUrl}
2. **Check MCP server status:** ${puppeteerServer.name}
3. **Test manually:** Open ${projectUrl} in your browser`,
                error: String(error)
            };
        }
    }

    /**
     * Main chat handler for UI testing commands
     */
    public async handleUITestingChat(message: string): Promise<string> {
        const lowerMessage = message.toLowerCase();

        // MCP configuration commands
        if (lowerMessage.includes('configure mcp') || lowerMessage.includes('setup mcp')) {
            await this.autoConfigureMCP();
            const status = this.getMCPStatus();
            return `## ⚙️ MCP Configuration Complete

**Configured MCP Servers:**
${status.tools.map(tool => `- **${tool}**: Ready for UI testing`).join('\n')}

**Configuration File:** \`${status.configPath}\`

✅ **Ready for UI Testing!** Try: "Create UI test for login page"`;
        }

        // List MCP servers
        if (lowerMessage.includes('list mcp') || lowerMessage.includes('mcp status')) {
            const status = this.getMCPStatus();
            if (!status.configured) {
                return `## 📋 MCP Server Status

❌ **No MCP servers configured**

To set up UI testing tools, run: \`Configure MCP for UI testing\``;
            }

            return `## 📋 MCP Server Status

**Configured Servers:**
${status.tools.map(tool => `✅ **${tool}** - Ready for browser automation`).join('\n')}

**Configuration:** \`${status.configPath}\``;
        }

        // Puppeteer-specific commands
        if (this.isPuppeteerCommand(lowerMessage)) {
            const result = await this.executeBrowserAutomation(message);
            return result.message;
        }

        // UI testing commands  
        if (lowerMessage.includes('ui test') || lowerMessage.includes('test ui') || 
            lowerMessage.includes('browser test') || lowerMessage.includes('create test')) {
            
            try {
                const scenario = await this.createTestScenario(message);
                const result = await this.executeUITest(scenario);
                return result.message;
            } catch (error) {
                return `❌ **UI Testing Error:** ${error}

**Quick Setup:**
Run \`Configure MCP for UI testing\` to get started with browser automation.`;
            }
        }

        // Help message
        return `## 🎭 UI Testing Assistant

I can help you run **real browser automation tests** using MCP tools!

### 🔧 **Setup Commands:**
- \`Configure MCP for UI testing\` - Auto-setup Playwright/Puppeteer
- \`List MCP servers\` - Check current configuration
- \`MCP status\` - View tool availability

### 🚀 **Testing Commands:**
- \`Create UI test for login page at localhost:3000\`
- \`Test form validation on my app\`  
- \`Run browser test for checkout flow\`
- \`Test navigation menu functionality\`

### ⚡ **Features:**
- 🤖 Real browser automation via MCP
- 📸 Automatic screenshot capture  
- 🔍 Smart element detection
- 📊 Detailed test reporting
- 🛠️ Auto-configuration of tools

**💡 Start with:** \`Configure MCP for UI testing\``;
    }

    private isPuppeteerCommand(lowerMessage: string): boolean {
        return (lowerMessage.includes('puppeteer') && lowerMessage.includes('mcp')) ||
               (lowerMessage.includes('open') && lowerMessage.includes('web project') && lowerMessage.includes('puppeteer')) ||
               (lowerMessage.includes('puppeteer') && (lowerMessage.includes('open') || lowerMessage.includes('launch') || lowerMessage.includes('start')));
    }

    private detectProjectUrl(message: string): string {
        const urlMatch = message.match(/https?:\/\/[^\s]+|localhost:\d+/);
        if (urlMatch) {
            return urlMatch[0].startsWith('http') ? urlMatch[0] : `http://${urlMatch[0]}`;
        }
        return 'http://localhost:3000';
    }

    private createBrowserAutomationScenario(message: string, url: string): any {
        const lowerMessage = message.toLowerCase();
        
        const scenario = {
            name: 'web_project_automation',
            url: url,
            description: 'Open and interact with web project using browser automation',
            actions: [] as string[]
        };

        if (lowerMessage.includes('open') || lowerMessage.includes('navigate')) {
            scenario.actions.push('Navigate to the web project');
            scenario.actions.push('Take a screenshot of the current page');
            scenario.actions.push('Analyze page structure and content');
        }

        if (lowerMessage.includes('test') || lowerMessage.includes('check')) {
            scenario.actions.push('Check if page loads successfully');
            scenario.actions.push('Verify key elements are present');
            scenario.actions.push('Test basic functionality');
        }

        if (scenario.actions.length === 0) {
            scenario.actions = [
                'Navigate to the web project',
                'Take a screenshot of the current page',
                'Analyze page content and structure',
                'Check for any console errors',
                'Report findings'
            ];
        }

        return scenario;
    }
}