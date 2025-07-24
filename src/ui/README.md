# UI Directory Structure

This directory contains all UI components for the Claude Dev extension, organized by file type for better maintainability.

## Directory Structure

```
src/ui/
├── docs/           # Documentation files
│   └── README-themes.md
├── scripts/        # JavaScript files
│   └── chat-view.js
├── services/       # TypeScript service files
│   ├── chat-view-provider.ts
│   └── html-template-service.ts
├── styles/         # CSS stylesheets
│   ├── chat-view.css    # Main chat interface styles
│   ├── mcp-modal.css    # MCP server modal styles
│   └── themes.css       # Theme system and color palette
└── views/          # HTML templates
    └── chat-view.html
```

## Style Architecture

### Color Theme
The UI uses a consistent orange color palette:
- Primary: `#FF6B35` (main orange)
- Secondary: `#FF8E53` (lighter orange)
- Tertiary: `#FFA07A` (lightest orange)

### Files
- **themes.css**: Contains the core theme system with CSS custom properties
- **chat-view.css**: Main interface styles including message bubbles, input areas, and controls
- **mcp-modal.css**: Styles for MCP server management modals with orange theme integration

## Development Notes

- All styles use CSS custom properties for consistent theming
- Hover effects include subtle animations and color transitions
- The orange theme is applied consistently across buttons, borders, and interactive elements
- Form elements use orange focus states for better user experience