/* Rag — zero-dependency retrieval (BM25 over code-aware tokens), RAGina style.
 * Works in Node (require) and in the browser (<script src="lib/rag.js"> -> window.Rag). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Rag = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STOP = new Set(('a an the and or of to in on for with is are was were be been it its this that these those ' +
    'as at by from into than then so if not no do does did can could should would will just about which who whom ' +
    'what when where how why i you we they he she them his her our your their my me us').split(' '));

  function stem(w) {
    if (w.length > 4 && w.slice(-3) === 'ies') w = w.slice(0, -3) + 'y';
    else if (w.length > 5 && w.slice(-3) === 'ing') w = w.slice(0, -3);
    else if (w.length > 4 && w.slice(-2) === 'ed') w = w.slice(0, -2);
    else if (w.length > 3 && w.slice(-1) === 's' && w.slice(-2) !== 'ss' && w.slice(-2) !== 'us') w = w.slice(0, -1);
    if (w.length > 3 && w.slice(-1) === 'e') w = w.slice(0, -1);
    return w;
  }

  function tokenize(text) {
    var s = String(text || '')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/[_\-./:#]+/g, ' ')
      .toLowerCase();
    var out = [];
    var m = s.match(/[a-z0-9]+/g) || [];
    for (var i = 0; i < m.length; i++) {
      if (m[i].length < 2 || STOP.has(m[i])) continue;
      out.push(stem(m[i]));
    }
    return out;
  }

  function chunkText(path, text, opts) {
    opts = opts || {};
    var max = opts.maxChars || 1200;
    var overlap = opts.overlap === undefined ? 3 : opts.overlap;
    var lines = String(text || '').split('\n');
    var chunks = [], buf = [], len = 0, start = 1;
    function flush(endLine) {
      var t = buf.join('\n').trim();
      if (t) chunks.push({ path: path, start: start, end: endLine, text: t });
    }
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].length > 400 ? lines[i].slice(0, 400) + '…' : lines[i];
      if (len + line.length + 1 > max && buf.length) {
        flush(i);
        buf = overlap > 0 ? buf.slice(-overlap) : [];
        start = i - buf.length + 1;
        len = 0;
        for (var b = 0; b < buf.length; b++) len += buf[b].length + 1;
      }
      buf.push(line);
      len += line.length + 1;
    }
    flush(lines.length);
    return chunks;
  }

  function ref(c) { return c.start ? c.path + ':' + c.start + '-' + c.end : c.path; }

  function createIndex(chunks) {
    var K1 = 1.5, B = 0.75, PATH_BOOST = 3;
    var docs = [], df = Object.create(null), total = 0;
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      var toks = tokenize(c.text), ptoks = tokenize(c.path);
      var tf = Object.create(null);
      for (var a = 0; a < toks.length; a++) tf[toks[a]] = (tf[toks[a]] || 0) + 1;
      for (var p = 0; p < ptoks.length; p++) tf[ptoks[p]] = (tf[ptoks[p]] || 0) + PATH_BOOST;
      var len = toks.length + ptoks.length * PATH_BOOST;
      for (var term in tf) df[term] = (df[term] || 0) + 1;
      docs.push({ c: c, tf: tf, len: len });
      total += len;
    }
    var N = docs.length, avgdl = N ? total / N : 1;

    function search(query, k, opts) {
      k = k || 6;
      var perFile = (opts && opts.perFile) || 3;
      var q = tokenize(query), seen = Object.create(null), terms = [];
      for (var i = 0; i < q.length; i++) if (!seen[q[i]]) { seen[q[i]] = 1; terms.push(q[i]); }
      if (!terms.length) return [];
      var phrase = String(query || '').toLowerCase().trim();
      var scored = [];
      for (var d = 0; d < docs.length; d++) {
        var doc = docs[d], score = 0;
        for (var t = 0; t < terms.length; t++) {
          var f = doc.tf[terms[t]];
          if (!f) continue;
          var n = df[terms[t]];
          var idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
          score += idf * (f * (K1 + 1)) / (f + K1 * (1 - B + B * doc.len / avgdl));
        }
        if (score > 0 && phrase.length > 6 && doc.c.text.toLowerCase().indexOf(phrase) !== -1) score += 2;
        if (score > 0) scored.push({ c: doc.c, score: score });
      }
      scored.sort(function (x, y) { return y.score - x.score; });
      var out = [], counts = Object.create(null);
      for (var s = 0; s < scored.length && out.length < k; s++) {
        var pth = scored[s].c.path;
        if ((counts[pth] || 0) >= perFile) continue;
        counts[pth] = (counts[pth] || 0) + 1;
        out.push({ chunk: scored[s].c, score: scored[s].score });
      }
      return out;
    }

    return { size: N, search: search };
  }

  function formatContext(hits, maxChars) {
    var budget = maxChars || 8000, out = '';
    for (var i = 0; i < hits.length; i++) {
      var block = '[' + ref(hits[i].chunk) + ']\n' + hits[i].chunk.text + '\n\n';
      if (out.length + block.length > budget) { out += block.slice(0, Math.max(0, budget - out.length)); break; }
      out += block;
    }
    return out.trim();
  }

  return { tokenize: tokenize, chunkText: chunkText, createIndex: createIndex, formatContext: formatContext, ref: ref };
});