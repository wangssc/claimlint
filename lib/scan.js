'use strict';

const FENCE = /^\s*(```|~~~)/;
const IGNORE = /<!--\s*claimlint:ignore-next\s*-->/;

function stripQuoted(s) {
  return s
    .replace(/「[^」]*」/g, '「」')
    .replace(/『[^』]*』/g, '『』')
    .replace(/“[^”]*”/g, '“”')
    .replace(/"[^"\n]*"/g, '""')
    .replace(/`[^`]*`/g, '``');
}

function attachSections(blocks) {
  let cur = { level: 0, title: '', line: 1, blocks: [] };
  const sections = [cur];
  for (const b of blocks) {
    if (b.type === 'heading') {
      cur = { level: b.level, title: b.text, line: b.line, blocks: [] };
      sections.push(cur);
    }
    b.section = cur;
    cur.blocks.push(b);
  }
  return sections;
}

function scan(text) {
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let inFence = false;
  let para = null;
  let pendingIgnore = false;

  function push(b) {
    if (pendingIgnore) {
      b.ignored = true;
      pendingIgnore = false;
    }
    if (b.clean === undefined) b.clean = stripQuoted(b.text);
    blocks.push(b);
  }

  function flush() {
    if (para) {
      para.clean = stripQuoted(para.text);
      push(para);
      para = null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (IGNORE.test(raw)) {
      flush();
      pendingIgnore = true;
      continue;
    }

    if (FENCE.test(raw)) {
      const last = blocks[blocks.length - 1];
      if (!inFence) {
        flush();
        inFence = true;
        push({ type: 'code', line: lineNo, text: raw, clean: '' });
      } else {
        inFence = false;
        if (last && last.type === 'code') last.text += '\n' + raw;
      }
      continue;
    }

    if (inFence) {
      const last = blocks[blocks.length - 1];
      if (last && last.type === 'code') last.text += '\n' + raw;
      continue;
    }

    if (trimmed === '') {
      flush();
      continue;
    }

    const h = raw.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      flush();
      push({ type: 'heading', level: h[1].length, line: lineNo, text: h[2].trim(), clean: stripQuoted(h[2].trim()) });
      continue;
    }

    if (/^\s*\|/.test(raw)) {
      flush();
      push({ type: 'table', line: lineNo, text: trimmed, clean: stripQuoted(trimmed) });
      continue;
    }

    if (/^\s*([-*+]|\d+\.)\s+/.test(raw)) {
      flush();
      push({ type: 'list', line: lineNo, text: trimmed, clean: stripQuoted(trimmed) });
      continue;
    }

    if (!para) para = { type: 'para', line: lineNo, text: trimmed };
    else para.text += ' ' + trimmed;
  }
  flush();

  const sections = attachSections(blocks);
  return { lines, blocks, sections, text };
}

const EVIDENCE_PATTERNS = [
  /```/,
  /`[^`\n]+`/,
  /\b\d+\s*\/\s*\d+\b/,
  /\d{1,3}(\.\d+)?\s*%/,
  /\b\d{3,}\b/,
  /[A-Za-z]:\\/,
  /(^|[\s(])\/[\w.-]{2,}/,
  /https?:\/\//,
  /\b(npm|node|python|pytest|jest|go|cargo|make|curl|git|docker|pnpm|yarn)\s+[\w.@:/-]+/,
];

function hasEvidence(str) {
  return EVIDENCE_PATTERNS.some((re) => re.test(str));
}

function sectionText(section) {
  return section.blocks.map((b) => b.text).join('\n');
}

function effectiveLines(lines) {
  return lines.filter((l) => {
    const t = l.trim();
    if (t === '') return false;
    if (t.startsWith('|')) return false;
    if (/^[-=*_]{3,}$/.test(t)) return false;
    return true;
  }).length;
}

module.exports = { scan, hasEvidence, sectionText, effectiveLines, stripQuoted };
