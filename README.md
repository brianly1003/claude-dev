# Claude Dev

A VSCode extension that integrates Claude Code CLI to provide AI-powered code completion and chat functionality, similar to GitHub Copilot but specifically designed to work with Anthropic's Claude Code.

## Features

- **Real-time Chat Interface**: Chat with Claude about your code with full workspace context
- **Multi-turn Conversations**: Claude can actually explore your codebase, read files, and execute planned actions  
- **Code Completion**: Inline code suggestions powered by Claude Code CLI
- **Workspace Awareness**: Claude automatically understands your project structure and context
- **Permission Management**: YOLO mode for seamless development (bypass permission prompts)
- **Status Bar Integration**: Quick toggle and status indicator

## Installation

1. Install the Claude Code CLI:
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. Install this extension in VSCode

3. Open your project folder in VSCode

4. Start chatting with Claude using the sidebar panel or `Ctrl+Shift+C`

## Configuration

- `claudeDev.enabled`: Enable/disable Claude Dev suggestions
- `claudeDev.claudeCodePath`: Path to Claude Code CLI executable (default: "claude")
- `claudeDev.yoloMode`: Enable YOLO mode to bypass permission prompts (default: true)
- `claudeDev.enableLogging`: Enable debug logging
- `claudeDev.maxContextLines`: Maximum context lines to send to Claude
- `claudeDev.debounceMs`: Debounce delay for completion requests

## Usage

### Chat Interface
- Open the Claude Dev Chat panel in the Explorer sidebar
- Type your questions about the codebase
- Claude will explore files and provide contextual answers
- Ask Claude to implement features, debug issues, or explain code

### Code Completion
- Type code and see inline suggestions
- Accept suggestions with Tab
- Trigger manual completion with `Ctrl+Space`

### Commands
- `Claude Dev: Toggle` - Enable/disable the extension
- `Claude Dev: Open Chat` - Focus the chat panel
- `Claude Dev: Clear Chat` - Clear conversation history

## Architecture

This extension uses:
- **Claude Code SDK**: Official TypeScript SDK for programmatic integration
- **MCP (Model Context Protocol)**: Enables Claude to use filesystem, git, and other tools
- **Multi-turn Conversations**: Claude can plan and execute multiple actions
- **VSCode Webview**: Modern chat interface with theme integration

## Development

1. Clone this repository
2. Run `npm install`
3. Press F5 to launch Extension Development Host
4. Test the extension in the development environment

## License

MIT License - see LICENSE file for details

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.