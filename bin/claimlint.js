#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { scan, effectiveLines, stripQuoted } = require('../lib/scan');
const { RULES } = require('../lib/rules');
const { renderText, renderJson, detectLang, paint, C } = require('../lib/report');

const VERSION = require('../package.json').version;

const HELP = `claimlint v${VERSION} — lint the claims, not the prose

用法 / usage
  claimlint <file...>            检查一份或多份 Markdown
  claimlint -                    从 stdin 读
  cat report.md | claimlint -

选项 / options
  --json              输出 JSON（给 CI 用）
  --strict            warning 也算失败（退出码 1）
  --rules a,b        只跑指定规则，见 --list
  --lang zh|en       强制输出语言，默认按内容自动判断
  --list             列出全部规则
  --no-color         关掉颜色
  -h, --help         这份说明
  -v, --version      版本号

退出码 / exit code
  0  没有 error（--strict 时连 warning 也不能有）
  1  有 error
  2  用法错误

例 / example
  claimlint report.md
  claimlint docs/*.md --strict
  claimlint --json report.md | jq '.files[0].summary'
`;

function listRules(opts) {
  const lang = opts.lang || 'zh';
  const lines = [];
  lines.push('');
  lines.push(paint(C.bold, '  ' + (lang === 'zh' ? '8 条规则' : '8 rules')));
  lines.push('');
  for (const r of RULES) {
    lines.push(
      '  ' +
        paint(C.gray, r.id.padEnd(26)) +
        paint(r.level === 'error' ? C.red : r.level === 'warning' ? C.yellow : C.blue, r.level.padEnd(9)) +
        r.title[lang]
    );
  }
  lines.push('');
  console.log(lines.join('\n'));
}

function readInput(file) {
  if (file === '-') return fs.readFileSync(0, 'utf8');
  return fs.readFileSync(file, 'utf8');
}

function run(file, text, opts, lang) {
  const s = scan(text);
  const eff = effectiveLines(s.lines);
  const ctx = { text, clean: stripQuoted(text), blocks: s.blocks, sections: s.sections, effLines: eff };
  const active = opts.rules ? RULES.filter((r) => opts.rules.includes(r.id)) : RULES;
  const issues = [];
  for (const r of active) {
    let hits = [];
    try {
      hits = r.check(ctx) || [];
    } catch (e) {
      hits = [];
    }
    for (const hit of hits) {
      issues.push({
        rule: r.id,
        level: r.level,
        line: hit.line,
        sample: hit.sample || '',
        title: r.title[lang],
        why: r.why[lang],
        fix: r.fix[lang],
      });
    }
  }
  const order = { error: 0, warning: 1, note: 2 };
  const key = (i) => (i.line === 0 ? 1e9 : i.line);
  issues.sort((a, b) => key(a) - key(b) || order[a.level] - order[b.level]);
  return { file, issues, effLines: eff };
}

function main(argv) {
  const files = [];
  const opts = { json: false, lang: null, strict: false, rules: null };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return console.log(HELP), 0;
    if (a === '-v' || a === '--version') return console.log(VERSION), 0;
    if (a === '--json') opts.json = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--no-color') {
    } else if (a === '--list') return listRules(opts), 0;
    else if (a === '--lang') opts.lang = argv[++i];
    else if (a.startsWith('--lang=')) opts.lang = a.slice(7);
    else if (a === '--rules') opts.rules = String(argv[++i] || '').split(',').filter(Boolean);
    else if (a.startsWith('--rules=')) opts.rules = a.slice(8).split(',').filter(Boolean);
    else if (a === '-') files.push('-');
    else if (a.startsWith('-')) {
      console.error(`unknown option: ${a}`);
      return 2;
    } else files.push(a);
  }

  if (files.length === 0) {
    console.log(HELP);
    return 2;
  }

  const results = [];
  let allText = '';
  for (const f of files) {
    try {
      const text = readInput(f);
      allText += text;
      results.push({ file: f, text });
    } catch (e) {
      results.push({ file: f, error: e.code === 'ENOENT' ? 'no such file' : e.message });
    }
  }

  const lang = opts.lang || detectLang(allText);
  const checked = results.map((r) => (r.error ? r : run(r.file, r.text, opts, lang)));

  if (opts.json) {
    console.log(renderJson(checked));
  } else {
    console.log(renderText(checked, lang, opts));
  }

  const errors = checked.reduce((a, r) => a + ((r.issues || []).filter((i) => i.level === 'error').length), 0);
  const warnings = checked.reduce((a, r) => a + ((r.issues || []).filter((i) => i.level === 'warning').length), 0);
  const fatal = checked.some((r) => r.error);

  if (fatal || errors > 0) return 1;
  if (opts.strict && warnings > 0) return 1;
  return 0;
}

process.exit(main(process.argv.slice(2)));
