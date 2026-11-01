# Bootstrap & Alpine UI Enhancer

Adds Bootstrap 5 CSS/JS and Alpine.js to the generated app, injects a responsive navbar placeholder and sets up Alpine data for quick UI reactivity, improving layout and interactive capabilities without altering existing user code.

## Target
`lib/plugins/bootstrap-alpine-enhancer.js`

## Code
```javascript
const path = require('path');

module.exports = {
  name: 'bootstrap-alpine-enhancer',
  execute: async (context) => {
    // Guard clauses
    if (!context || !context.files || typeof context.files !== 'object') return;
    if (!context.files['index.html']) return;

    let html = context.files['index.html'];

    // CDN resources
    const bootstrapCss = '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-ENjdO4Dr2bkBIFxQpeoYz1HIb6+1L9gq6a7k6R9a9p6G6V9p5h6V6K3N9T9qv0T" crossorigin="anonymous">';
    const bootstrapJs = '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-kenU1KFdBIe4zVF0s0G1M5b4hcpxyD9F7jL+2l9P5R6R6N9T9qv0T+5G6V9p6G6V" crossorigin="anonymous"></script>';
    const alpineJs = '<script src="https://cdn.jsdelivr.net/npm/alpinejs@3.13.0/dist/cdn.min.js" defer></script>';

    // Insert Bootstrap CSS into </head>
    if (!html.includes('bootstrap.min.css')) {
      if (html.includes('</head>')) {
        html = html.replace('</head>', `  ${bootstrapCss}\n</head>`);
      } else {
        // Fallback: prepend to the document
        html = `${bootstrapCss}\n${html}`;
      }
    }

    // Insert Bootstrap JS before </body>
    if (!html.includes('bootstrap.bundle.min.js')) {
      if (html.includes('</body>')) {
        html = html.replace('</body>', `  ${bootstrapJs}\n</body>`);
      } else {
        // Fallback: append to the document
        html = `${html}\n${bootstrapJs}`;
      }
    }

    // Insert Alpine.js into </head>
    if (!html.includes('alpinejs')) {
      if (html.includes('</head>')) {
        html = html.replace('</head>', `  ${alpineJs}\n</head>`);
      } else {
        html = `${alpineJs}\n${html}`;
      }
    }

    // Navbar placeholder after opening <body>
    const navbarPlaceholder = `
    <nav class="navbar navbar-expand-lg navbar-light bg-light" x-data="{open:false}">
      <div class="container-fluid">
        <a class="navbar-brand" href="#">MyApp</a>
        <button class="navbar-toggler" type="button" @click="open = !open" aria-controls="navbarSupportedContent" aria-expanded="false" aria-label="Toggle navigation">
          <span class="navbar-toggler-icon"></span>
        </button>
        <div class="collapse navbar-collapse" :class="{'show': open}" id="navbarSupportedContent">
          <ul class="navbar-nav me-auto mb-2 mb-lg-0">
            <li class="nav-item"><a class="nav-link active" aria-current="page" href="#">Home</a></li>
            <li class="nav-item"><a class="nav-link" href="#">Features</a></li>
            <li class="nav-item"><a class="nav-link" href="#">Pricing</a></li>
          </ul>
        </div>
      </div>
    </nav>`;

    if (!html.includes('navbar navbar-expand-lg')) {
      if (html.includes('<body>')) {
        html = html.replace('<body>', `<body>\n${navbarPlaceholder}`);
      } else if (html.includes('<body')) {
        // Handles <body ...> case
        html = html.replace(/<body[^>]*>/, (match) => `${match}\n${navbarPlaceholder}`);
      } else {
        // Fallback: prepend to document
        html = `${navbarPlaceholder}\n${html}`;
      }
    }

    // Alpine init script before </body>
    const alpineInit = '<script>document.addEventListener("alpine:init", () => { console.log("Alpine.js initialized"); });</script>';
    if (!html.includes('alpine:init')) {
      if (html.includes('</body>')) {
        html = html.replace('</body>', `  ${alpineInit}\n</body>`);
      } else {
        html = `${html}\n${alpineInit}`;
      }
    }

    // Update index.html
    context.files['index.html'] = html;

    // Append helper CSS if style.css exists
    if (context.files['style.css']) {
      let css = context.files['style.css'];
      const helper = '\n/* Added by bootstrap-alpine-enhancer */\nbody { padding-top: 56px; }\n';
      if (!css.includes('padding-top: 56px')) {
        css += helper;
        context.files['style.css'] = css;
      }
    }

    // No changes to script.js needed for now
  }
};
```