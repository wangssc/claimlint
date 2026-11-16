#!/usr/bin/env node
'use strict';

// 把 CLI 的真实 ANSI 输出渲染成终端样式的 SVG。
// 输出内容就是命令跑出来的原文，一个字都不改写——不手工编辑图片里的文字。

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const TARGET = process.argv[2] || 'test/fixtures/bad.md';
const OUT = process.argv[3] || 'docs/demo.svg';

const CHAR_W = 8.12;
const FONT_SIZE = 13.5;
const LINE_H = 21;
const PAD_X = 26;
const BAR_H = 40;

const COLOR = {
  2: '#8b949e', // dim
  1: '#e6edf3', // bold
  31: '#f85149',
  33: '#d29922',
  34: '#58a6ff',
  36: '#39c5cf',
  90: '#6e7681',
  32: '#3fb950',
};

function run() {
  const opts = {
    cwd: ROOT,
    env: { ...process.env, FORCE_COLOR: '3', NO_COLOR: '' },
    encoding: 'utf8',
  };
  const bin = path.join(ROOT, 'bin/claimlint.js');
  let out;
  try {
    out = execFileSync(process.execPath, [bin, TARGET], opts);
  } catch (e) {
    // 退出码 1 表示「发现了 error」，这是这个工具的预期输出，不是失败
    if (e.status !== 1 || !e.stdout) throw e;
    out = e.stdout;
  }
  return out.replace(/\n+$/, '');
}

// ANSI SGR -> [{text, style}]
function parse(line) {
  const runs = [];
  let style = {};
  const re = /\x1b\[([0-9;]*)m/g;
  let last = 0;
  let m;
  while ((m = re.exec(line))) {
    if (m.index > last) runs.push({ text: line.slice(last, m.index), style });
    const codes = m[1].split(';').filter(Boolean).map(Number);
    if (codes.length === 0 || codes.includes(0)) style = {};
    for (const c of codes) {
      if (c === 0) style = {};
      else if (c === 1) style.bold = true;
      else if (c === 2) style.dim = true;
      else if (COLOR[c]) style.color = c;
    }
    last = m.index + m[0].length;
  }
  if (last < line.length) runs.push({ text: line.slice(last), style });
  return runs;
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function displayWidth(s) {
  let w = 0;
  for (const ch of s) w += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/.test(ch) ? 2 : 1;
  return w;
}

function render() {
  const raw = run();
  const lines = raw.split('\n');
  const prompt = `$ npx claimlint ${TARGET}`;
  const all = [prompt, ''].concat(lines);

  let maxW = 0;
  const parsed = all.map((l) => {
    const runs = l === prompt ? [{ text: l, style: { bold: true } }] : parse(l);
    const w = displayWidth(runs.map((r) => r.text).join(''));
    if (w > maxW) maxW = w;
    return runs;
  });

  const width = Math.max(720, Math.min(1060, Math.ceil(maxW * CHAR_W) + PAD_X * 2 + 20));
  const bodyH = all.length * LINE_H + 20;
  const height = BAR_H + bodyH;

  const body = [];
  parsed.forEach((runs, i) => {
    const y = BAR_H + 24 + i * LINE_H;
    let x = PAD_X;
    const spans = runs.map((r) => {
      const fill = r.style.color ? COLOR[r.style.color] : r.style.dim ? '#8b949e' : '#c9d1d9';
      const weight = r.style.bold ? ' font-weight="600"' : '';
      const t = `<tspan x="${x.toFixed(1)}" fill="${fill}"${weight} xml:space="preserve">${esc(r.text)}</tspan>`;
      x += displayWidth(r.text) * CHAR_W;
      return t;
    });
    if (!spans.length) return;
    body.push(`<text y="${y}" font-size="${FONT_SIZE}" xml:space="preserve">${spans.join('')}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="ui-monospace,SFMono-Regular,Menlo,Consolas,'Liberation Mono',monospace" role="img" aria-label="claimlint 终端输出">
  <defs>
    <clipPath id="win"><rect width="${width}" height="${height}" rx="9"/></clipPath>
  </defs>
  <g clip-path="url(#win)">
    <rect width="${width}" height="${height}" fill="#0d1117"/>
    <rect width="${width}" height="${BAR_H}" fill="#161b22"/>
    <line x1="0" y1="${BAR_H}" x2="${width}" y2="${BAR_H}" stroke="#30363d" stroke-width="1"/>
    <circle cx="20" cy="20" r="5.5" fill="#f85149" opacity="0.85"/>
    <circle cx="38" cy="20" r="5.5" fill="#d29922" opacity="0.85"/>
    <circle cx="56" cy="20" r="5.5" fill="#3fb950" opacity="0.85"/>
    <text x="${width / 2}" y="24.5" font-size="11.5" fill="#8b949e" text-anchor="middle">claimlint — ${esc(TARGET)}</text>
    ${body.join('\n    ')}
  </g>
  <rect x="0.5" y="0.5" width="${width - 1}" height="${height - 1}" rx="9" fill="none" stroke="#30363d"/>
</svg>
`;
}

const svg = render();
fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), svg);
console.log(`${OUT}  ${svg.length} 字节`);
