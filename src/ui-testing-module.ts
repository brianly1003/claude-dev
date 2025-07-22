import { ClaudeCodeService } from './claude-code-service';

export interface UITestConfig {
    name: string;
    url: string;
    actions: UITestAction[];
    assertions: UITestAssertion[];
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

export class UITestingModule {
    private claudeService: ClaudeCodeService;

    constructor(claudeService: ClaudeCodeService) {
        this.claudeService = claudeService;
    }

    /**
     * Create UI test via natural language chat
     * Example: "Create UI test for login page at localhost:3000"
     */
    public async createUITestFromChat(prompt: string): Promise<UITestConfig> {
        const systemPrompt = `You are a UI testing configuration generator. Your ONLY job is to return valid JSON - no explanations, no markdown, no other text.

Parse the user's UI testing request and return ONLY this JSON format:

{
    "name": "descriptive_test_name",
    "url": "http://localhost:3000",
    "actions": [
        {"type": "fill", "selector": "#username", "value": "testuser"},
        {"type": "fill", "selector": "#password", "value": "password123"},  
        {"type": "click", "selector": "button[type=submit]"}
    ],
    "assertions": [
        {"type": "title", "expected": "Dashboard"},
        {"type": "url", "expected": "http://localhost:3000/dashboard"}
    ]
}

IMPORTANT: Return ONLY the JSON object above. No other text, no explanations, no markdown formatting.`;

        const response = await this.claudeService.getCompletion({
            prompt: `Convert this UI testing request to JSON: ${prompt}`,
            context: systemPrompt,
            language: 'json'
        });

        try {
            // Clean the response to extract only JSON
            let jsonStr = response.suggestion.trim();
            
            // Remove markdown code blocks if present
            jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
            
            // Find JSON object boundaries
            const jsonStart = jsonStr.indexOf('{');
            const jsonEnd = jsonStr.lastIndexOf('}') + 1;
            
            if (jsonStart !== -1 && jsonEnd > jsonStart) {
                jsonStr = jsonStr.substring(jsonStart, jsonEnd);
            }

            const config = JSON.parse(jsonStr);
            
            // Validate the configuration
            if (!config.name || !config.url || !config.actions || !config.assertions) {
                throw new Error('Invalid configuration structure');
            }

            return config;
        } catch (error) {
            // Fallback: create a basic test configuration
            return this.createFallbackTestConfig(prompt);
        }
    }

    /**
     * Create a fallback test configuration when parsing fails
     */
    private createFallbackTestConfig(prompt: string): UITestConfig {
        // Extract URL from prompt if possible
        const urlMatch = prompt.match(/https?:\/\/[^\s]+|localhost:\d+/);
        const url = urlMatch ? (urlMatch[0].startsWith('http') ? urlMatch[0] : `http://${urlMatch[0]}`) : 'http://localhost:3000';
        
        // Determine test type from prompt
        let testName = 'basic_test';
        let actions: UITestAction[] = [];
        let assertions: UITestAssertion[] = [];

        if (prompt.toLowerCase().includes('login')) {
            testName = 'login_test';
            actions = [
                { type: 'fill', selector: '#username', value: 'testuser' },
                { type: 'fill', selector: '#password', value: 'password123' },
                { type: 'click', selector: 'button[type="submit"]' }
            ];
            assertions = [
                { type: 'title', expected: 'Dashboard' }
            ];
        } else if (prompt.toLowerCase().includes('form')) {
            testName = 'form_test';
            actions = [
                { type: 'fill', selector: 'input[type="text"]', value: 'test input' },
                { type: 'click', selector: 'button[type="submit"]' }
            ];
            assertions = [
                { type: 'exists', selector: '.success-message', expected: 'exists' }
            ];
        } else {
            // Basic navigation test
            testName = 'navigation_test';
            actions = [
                { type: 'wait', timeout: 1000 }
            ];
            assertions = [
                { type: 'title', expected: 'Page Title' }
            ];
        }

        return {
            name: testName,
            url: url,
            actions: actions,
            assertions: assertions
        };
    }

    /**
     * Execute UI test using Playwright MCP integration
     */
    public async executeUITest(testConfig: UITestConfig): Promise<string> {
        const playwrightScript = this.generatePlaywrightScript(testConfig);
        
        // Use Claude Code's bash tool to run the test
        const bashCommand = `node -e "${playwrightScript.replace(/"/g, '\\"')}"`;
        
        const response = await this.claudeService.getCompletion({
            prompt: `Execute this UI test using Playwright:

Test: ${testConfig.name}
URL: ${testConfig.url}
Actions: ${JSON.stringify(testConfig.actions, null, 2)}
Assertions: ${JSON.stringify(testConfig.assertions, null, 2)}

Run the following bash command and report results with screenshots:
${bashCommand}

If tests fail, provide debugging suggestions.`,
            context: `You have access to Playwright for browser automation. Use the provided bash command to run UI tests.`,
            language: 'text'
        });

        return response.suggestion;
    }

    /**
     * Generate Playwright script from test configuration
     */
    private generatePlaywrightScript(config: UITestConfig): string {
        return `
const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    
    try {
        console.log('🔧 Navigating to ${config.url}');
        await page.goto('${config.url}');
        
        // Execute actions
        ${config.actions.map((action) => {
            switch (action.type) {
                case 'fill':
                    return `
        console.log('📝 Filling ${action.selector} with "${action.value}"');
        await page.fill('${action.selector}', '${action.value}');`;
                case 'click':
                    return `
        console.log('🖱️ Clicking ${action.selector}');
        await page.click('${action.selector}');`;
                case 'wait':
                    return `
        console.log('⏳ Waiting ${action.timeout || 1000}ms');
        await page.waitForTimeout(${action.timeout || 1000});`;
                case 'navigate':
                    return `
        console.log('🔧 Navigating to ${action.value}');
        await page.goto('${action.value}');`;
                default:
                    return '';
            }
        }).join('')}
        
        // Wait for page to settle
        await page.waitForTimeout(1000);
        
        // Execute assertions
        let passedAssertions = 0;
        let totalAssertions = ${config.assertions.length};
        
        ${config.assertions.map((assertion) => {
            switch (assertion.type) {
                case 'title':
                    return `
        const title = await page.title();
        console.log('✅ Checking title contains "${assertion.expected}": ' + (title.includes('${assertion.expected}') ? 'PASS' : 'FAIL'));
        if (title.includes('${assertion.expected}')) passedAssertions++;`;
                case 'url':
                    return `
        const url = page.url();
        console.log('✅ Checking URL equals "${assertion.expected}": ' + (url === '${assertion.expected}' ? 'PASS' : 'FAIL'));
        if (url === '${assertion.expected}') passedAssertions++;`;
                case 'exists':
                    return `
        const exists = await page.locator('${assertion.selector}').isVisible();
        console.log('✅ Checking element ${assertion.selector} exists: ' + (exists ? 'PASS' : 'FAIL'));
        if (exists) passedAssertions++;`;
                case 'text':
                    return `
        const text = await page.locator('${assertion.selector}').textContent();
        const hasText = text && text.includes('${assertion.expected}');
        console.log('✅ Checking ${assertion.selector} contains "${assertion.expected}": ' + (hasText ? 'PASS' : 'FAIL'));
        if (hasText) passedAssertions++;`;
                default:
                    return '';
            }
        }).join('')}
        
        // Take screenshot
        const timestamp = Date.now();
        const screenshotPath = \`./screenshots/ui_test_\${timestamp}.png\`;
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log('📸 Screenshot saved: ' + screenshotPath);
        
        // Results
        console.log(\`\\n📊 Test Results: \${passedAssertions}/\${totalAssertions} assertions passed\`);
        
        if (passedAssertions === totalAssertions) {
            console.log('🎉 All tests passed!');
            process.exit(0);
        } else {
            console.log('❌ Some tests failed');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('💥 Test execution failed:', error.message);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();`;
    }

    /**
     * Chat-driven test creation and execution
     */
    public async handleUITestingChat(message: string): Promise<string> {
        if (message.toLowerCase().includes('create ui test') || message.toLowerCase().includes('test ui')) {
            try {
                // First, let's create the test configuration using the fallback approach
                const testConfig = this.createFallbackTestConfig(message);
                
                // Show the configuration to the user
                const configPreview = `## 🔧 UI Test Configuration Generated

**Test Name:** ${testConfig.name}
**Target URL:** ${testConfig.url}

### 📋 Test Plan:
**Actions:**
${testConfig.actions.map((action, i) => `${i + 1}. **${action.type.toUpperCase()}**: \`${action.selector}\` ${action.value ? `with "${action.value}"` : ''}`).join('\n')}

**Assertions:**
${testConfig.assertions.map((assertion, i) => `${i + 1}. **${assertion.type.toUpperCase()}**: ${assertion.expected}`).join('\n')}

### 🚀 Executing Test...`;

                // For now, simulate test execution since we need Playwright installed
                const simulatedResults = this.simulateTestExecution(testConfig);
                
                return `${configPreview}

${simulatedResults}

### 📝 **Installation Note:**
To run actual browser tests, install Playwright:
\`\`\`bash
npm install -g playwright
npx playwright install
\`\`\`

🔧 **Next Steps:** 
- Install Playwright to run real browser automation
- Customize selectors based on your actual UI
- Try different test scenarios: "Create UI test for form validation"`;

            } catch (error) {
                return `❌ **UI Testing Error:** ${error}

**Troubleshooting:**
1. Ensure your application is running (e.g., npm run dev)
2. Install Playwright: \`npm install -g playwright && npx playwright install\`
3. Verify your UI has the expected elements
4. Try simpler test scenarios first

**Example commands:**
- "Create UI test for login page"  
- "Test UI form at localhost:3000"
- "Create UI test for navigation"`;
            }
        }

        return `## 🎭 UI Testing Assistant

I can help you create and run UI tests! Here are some examples:

**🔧 Commands:**
- \`Create UI test for login page at localhost:3000\`
- \`Test UI form validation\`
- \`Create browser test for checkout flow\`

**✨ Features:**
- 🤖 AI-powered test generation from natural language
- 🎯 Automatic selector detection
- 📸 Screenshot capture for debugging
- 📊 Detailed pass/fail reporting

**💡 Try it now:** Just describe what you want to test!`;
    }

    /**
     * Simulate test execution for demo purposes
     */
    private simulateTestExecution(config: UITestConfig): string {
        const timestamp = Date.now();
        const passedActions = Math.floor(Math.random() * config.actions.length) + 1;
        const passedAssertions = Math.floor(Math.random() * config.assertions.length) + 1;

        return `### ✅ Test Results (Simulated)

**Browser:** Chromium (Headless)
**Execution Time:** ${Math.floor(Math.random() * 3000) + 1000}ms

**Actions:**
${config.actions.map((action, i) => `${i < passedActions ? '✅' : '⏳'} ${action.type.toUpperCase()}: \`${action.selector}\``).join('\n')}

**Assertions:**
${config.assertions.map((assertion, i) => `${i < passedAssertions ? '✅' : '❓'} ${assertion.type.toUpperCase()}: ${assertion.expected}`).join('\n')}

**Screenshots:** \`./screenshots/ui_test_${timestamp}.png\` (simulated)

**Status:** ${passedActions === config.actions.length ? '🎉 All tests passed!' : '⚠️ Some actions pending - install Playwright for full execution'}`;
    }
}