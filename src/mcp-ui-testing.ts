import { ClaudeCodeService } from './claude-code-service';
import { MCPManager } from './mcp-manager';

export interface UITestScenario {
    name: string;
    url: string;
    description: string;
    expectedElements?: string[];
    testFlow?: string[];
}

export class MCPUITesting {
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
     * Create UI test scenario from natural language
     */
    public async createTestScenario(prompt: string): Promise<UITestScenario> {
        // Extract URL and test details using pattern matching
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
                ]
            };
        }

        return scenario;
    }

    /**
     * Execute UI test using Claude with MCP tools
     */
    public async executeUITestWithMCP(scenario: UITestScenario): Promise<string> {
        // Check if MCP tools are available
        const availableTools = this.mcpManager.getUITestingTools();
        
        if (availableTools.length === 0) {
            return `❌ **MCP Tools Not Configured**

To run UI tests, you need to configure MCP servers. Would you like me to set this up automatically?

**Available options:**
- Playwright MCP Server (Recommended)
- Puppeteer MCP Server

Run: \`Configure MCP for UI testing\` to get started.`;
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

            return `## 🎭 UI Test Execution Results

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
- "Check mobile responsiveness"`;

        } catch (error) {
            return `❌ **UI Test Execution Failed**

Error: ${error}

**Troubleshooting:**
1. Verify MCP servers are running: ${availableTools.join(', ')}
2. Check if target URL is accessible: ${scenario.url}
3. Ensure Claude Code has permission to use MCP tools

**Debug Commands:**
- Check MCP status: \`List MCP servers\`
- Reconfigure tools: \`Configure MCP for UI testing\`
- Test connection: \`Test MCP connection\``;
        }
    }

    /**
     * Handle UI testing chat commands
     */
    public async handleUITestingChat(message: string): Promise<string> {
        const lowerMessage = message.toLowerCase();

        // MCP configuration commands
        if (lowerMessage.includes('configure mcp') || lowerMessage.includes('setup mcp')) {
            await this.autoConfigureMCP();
            return `## ⚙️ MCP Configuration Complete

**Configured MCP Servers:**
${this.mcpManager.listMCPServers().map(server => `- **${server.name}**: ${server.command} ${server.args.join(' ')}`).join('\n')}

**Configuration File:** \`~/.claude/claude.json\`
\`\`\`json
${this.mcpManager.generateClaudeConfig()}
\`\`\`

✅ **Ready for UI Testing!** Try: "Create UI test for login page"`;
        }

        // List MCP servers
        if (lowerMessage.includes('list mcp') || lowerMessage.includes('mcp status')) {
            const servers = this.mcpManager.listMCPServers();
            if (servers.length === 0) {
                return `## 📋 MCP Server Status

❌ **No MCP servers configured**

To set up UI testing tools, run: \`Configure MCP for UI testing\``;
            }

            return `## 📋 MCP Server Status

**Configured Servers:**
${servers.map(server => `✅ **${server.name}**
   - Command: \`${server.command} ${server.args.join(' ')}\`
   - Type: ${server.type}`).join('\n\n')}

**Configuration:** \`~/.claude/claude.json\``;
        }

        // UI testing commands  
        if (lowerMessage.includes('ui test') || lowerMessage.includes('test ui') || 
            lowerMessage.includes('browser test') || lowerMessage.includes('create test')) {
            
            try {
                const scenario = await this.createTestScenario(message);
                const results = await this.executeUITestWithMCP(scenario);
                return results;
            } catch (error) {
                return `❌ **UI Testing Error:** ${error}

**Quick Setup:**
Run \`Configure MCP for UI testing\` to get started with browser automation.`;
            }
        }

        // Help message
        return `## 🎭 MCP UI Testing Assistant

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

    /**
     * Get MCP configuration status
     */
    public getMCPStatus(): { configured: boolean; tools: string[]; configPath: string } {
        const allServers = this.mcpManager.listMCPServers();
        const allTools = allServers.map(server => server.name);
        
        return {
            configured: allTools.length > 0,
            tools: allTools,
            configPath: '~/.claude/claude.json'
        };
    }
}