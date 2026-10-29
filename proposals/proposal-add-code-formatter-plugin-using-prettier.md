# Add code formatter plugin using Prettier

Ensures that all JavaScript files are consistently formatted after mutations, reducing linting errors and improving readability across the Ariotica codebase.

## Proposed Code
```javascript
'use strict';\nconst prettier = require('prettier');\n\nmodule.exports = {\n  name: 'code-formatter',\n  execute: async (context) => {\n    // context.files is an object mapping file paths to their string content.\n    for (const [path, content] of Object.entries(context.files)) {\n      if (!path.endsWith('.js')) continue;\n      try {\n        const formatted = prettier.format(content, { parser: 'babel', singleQuote: true, trailingComma: 'all' });\n        context.files[path] = formatted;\n      } catch (_) {\n        // If formatting fails, leave the file unchanged.\n      }\n    }\n  }\n};
```

## Target Filename
`lib/codeFormatterPlugin.js`

## Commit Message
chore: add code formatter plugin with Prettier
