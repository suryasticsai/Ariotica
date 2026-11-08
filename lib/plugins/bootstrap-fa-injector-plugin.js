module.exports = {
  name: 'bootstrap-fa-injector',
  execute: async (context) => {
    const { files } = context;
    if (!files || typeof files !== 'object' || !files['index.html']) {
      throw new Error('index.html not found in context.files');
    }

    let html = files['index.html'];

    // Ensure <head> exists
    const headCloseTag = '</head>';
    if (!html.includes(headCloseTag)) {
      const htmlOpenIdx = html.search(/<html[^>]*>/i);
      if (htmlOpenIdx !== -1) {
        const insertPos = html.indexOf('>', htmlOpenIdx) + 1;
        html = html.slice(0, insertPos) + '\n<head>\n</head>' + html.slice(insertPos);
      } else {
        // Fallback: prepend head at start of document
        html = '<head>\n</head>\n' + html;
      }
    }

    // Prepare CDN links (escaped for HTML safety)
    const cdnLinks = [
      '<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet" integrity="sha384-ENjdO4Dr2bkBIFxQpeoYz1H0zW5y5v9E2e1K7a1c9gK5h5t+5f5v5t5f5f5f5f5" crossorigin="anonymous">',
      '<link href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css" rel="stylesheet" integrity="sha384-xxxx" crossorigin="anonymous">',
      '<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js" integrity="sha384-xxxx" crossorigin="anonymous"></script>'
    ];

    // Insert CDNs before </head> if not already present
    for (const link of cdnLinks) {
      if (!html.includes(link)) {
        html = html.replace(headCloseTag, link + '\n' + headCloseTag);
      }
    }

    // Add toast container at end of <body> if missing
    const toastContainer = '<div class="position-fixed bottom-0 end-0 p-3" style="z-index: 1100;"><div id="appToast" class="toast" role="alert" aria-live="assertive" aria-atomic="true"><div class="toast-header"><strong class="me-auto">Notification</strong><small class="text-muted">just now</small><button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button></div><div class="toast-body"></div></div></div>';

    if (!html.includes('id="appToast"')) {
      const bodyCloseTag = '</body>';
      const bodyCloseIdx = html.indexOf(bodyCloseTag);
      if (bodyCloseIdx !== -1) {
        html = html.slice(0, bodyCloseIdx) + toastContainer + '\n' + bodyCloseTag + html.slice(bodyCloseIdx + bodyCloseTag.length);
      } else {
        // fallback: append at end of document
        html += toastContainer;
      }
    }

    // Save mutated file
    files['index.html'] = html;
  }
};