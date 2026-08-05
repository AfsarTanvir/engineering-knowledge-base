# Utils

Reusable utility functions for the knowledge base.

## clipboard.js

Copy-to-clipboard functionality for code blocks.

### Functions

#### `copyToClipboard(text)`
Copies text to the user's clipboard.

**Parameters:**
- `text` (string): Text to copy

**Returns:** Promise<boolean> - True if successful

**Example:**
```javascript
import { copyToClipboard } from './utils/clipboard.js';

await copyToClipboard('SELECT * FROM users;');
```

#### `addCopyButtonsToCodeBlocks(container, options)`
Automatically adds copy buttons to all code blocks within a container.

**Parameters:**
- `container` (HTMLElement, optional): Element containing code blocks. Default: `document`
- `options` (Object, optional):
  - `buttonText` (string): Text for button. Default: `'Copy'`
  - `successText` (string): Text after copy. Default: `'Copied!'`
  - `successDuration` (number): Duration to show success text in ms. Default: `2000`

**Example:**
```javascript
import { addCopyButtonsToCodeBlocks } from './utils/clipboard.js';

// Add copy buttons to all pre tags
addCopyButtonsToCodeBlocks();

// Or with custom options
addCopyButtonsToCodeBlocks(document, {
  buttonText: '📋 Copy',
  successText: '✓ Done!',
  successDuration: 1500
});
```

## CSS Styling

Add this to your stylesheet to style the copy buttons:

```css
.copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 6px 12px;
  background: #007bff;
  color: white;
  border: none;
  cursor: pointer;
  font-size: 12px;
  border-radius: 4px;
}

.copy-btn:hover {
  background: #0056b3;
}
```

## markdown-viewer.html

A reusable HTML viewer for any markdown file in your repository. Automatically adds copy buttons to all code blocks.

**Usage:**
```
utils/markdown-viewer.html?file=PATH_TO_FILE
```

**Examples:**
```
utils/markdown-viewer.html?file=databases/query-optimization/slow-query-fixes.md
utils/markdown-viewer.html?file=doc/guides/setup.md
```

Just pass any relative path to a markdown file as the `file` query parameter.

## Files

- `clipboard.js` - Core utilities
- `markdown-viewer.html` - Universal markdown viewer with copy buttons
- `README.md` - This file
