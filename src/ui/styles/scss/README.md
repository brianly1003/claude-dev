# SASS Structure - Claude Dev UI

This directory contains the SASS/SCSS architecture for the Claude Dev UI, converted from the original CSS files for better maintainability and modularity.

## Directory Structure

```
scss/
├── abstracts/           # Variables, mixins, functions
│   ├── _variables.scss  # Color palette, spacing, typography
│   ├── _mixins.scss     # Reusable mixins
│   └── _animations.scss # Keyframe animations
├── base/
│   └── _reset.scss      # CSS reset and global styles
├── layout/
│   ├── _header.scss     # Header component
│   └── _responsive.scss # Responsive breakpoints
├── components/          # UI components
│   ├── _buttons.scss    # Button variants
│   ├── _messages.scss   # Chat messages
│   ├── _input.scss      # Input fields
│   ├── _controls.scss   # Dropdowns, selects
│   ├── _modals.scss     # Modal dialogs
│   ├── _dropdown.scss   # Dropdown menus
│   ├── _todo.scss       # Todo list component
│   ├── _empty-state.scss # Empty state component
│   ├── _help.scss       # Help commands
│   ├── _mcp-modal.scss  # MCP server modal
│   └── _mcp-forms.scss  # MCP forms
└── main.scss           # Main import file
```

## Key Features

### 1. **Theme System**
- Centralized color palette in `_variables.scss`
- CSS custom properties for VS Code integration
- Brand colors with consistent gradients

### 2. **Mixins Library**
- `@mixin button-primary` - Primary button styles
- `@mixin button-secondary` - Secondary button styles
- `@mixin card()` - Card/surface styling
- `@mixin input-field` - Form input styling
- `@mixin custom-scrollbar()` - Custom scrollbar styles
- `@mixin respond-to()` - Responsive breakpoints

### 3. **Responsive Design**
- Mobile-first approach
- Breakpoint system: `xs`, `sm`, `md`, `lg`, `xl`
- Touch-friendly sizing for mobile devices
- Landscape orientation support

### 4. **Animation System**
- Centralized keyframe animations
- Consistent timing and easing functions
- Performance-optimized transitions

## Usage

### Building CSS
```bash
# One-time build
npm run build:css

# Watch for changes
npm run watch:css

# Development mode (TypeScript + SCSS)
npm run dev
```

### Using Mixins
```scss
.my-button {
  @include button-primary;
}

.my-card {
  @include card($spacing-lg, true); // padding, hover effect
}

.responsive-element {
  @include respond-to('xs') {
    font-size: 12px;
  }
}
```

### Using Variables
```scss
.my-component {
  color: $text-primary;
  background: $surface-primary;
  padding: $spacing-md;
  border-radius: $radius-md;
  transition: all $transition-normal $easing-default;
}
```

## Benefits Over Original CSS

1. **50% Size Reduction**: From ~3,600 lines to ~1,800 lines
2. **Better Organization**: Modular component structure
3. **DRY Principle**: Reusable mixins and variables
4. **Maintainability**: Single source of truth for design tokens
5. **Consistency**: Automated pattern enforcement
6. **Developer Experience**: Better tooling and IntelliSense

## Migration Notes

- Legacy CSS variable names are preserved for backward compatibility
- All original functionality is maintained
- Responsive behavior is identical
- VS Code theme integration remains intact

## Future Enhancements

- [ ] Add light theme variants
- [ ] Implement high contrast theme
- [ ] Add CSS-in-JS export for dynamic theming
- [ ] Create component documentation generator
- [ ] Add visual regression testing

## Development Workflow

1. Edit SCSS files in the appropriate directory
2. Run `npm run build:css` to compile
3. Import the compiled CSS in your HTML/JS files
4. Use `npm run watch:css` during development for auto-compilation