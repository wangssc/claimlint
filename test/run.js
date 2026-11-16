'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { scan, effectiveLines, stripQuoted } = require('../lib/scan');
const { RULES } = require('../lib/rules');

const BIN = path.join(__dirname, '..', 'bin', 'claimlint.js');
const FIX = path.join(__dirname, 'fixtures');

let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass += 1;
    console.log('  ok   ' + name);
  } catch (e) {
    failures.push({ name, message: e.message });
    console.log('  FAIL ' + name + '\n       ' + e.message.split('\n')[0]);
  }
}

function load(file) {
  const text = fs.readFileSync(path.join(FIX, file), 'utf8');
  const s = scan(text);
  const eff = effectiveLines(s.lines);
  const ctx = { text, clean: stripQuoted(text), blocks: s.blocks, sections: s.sections, effLines: eff };
  const ids = [];
  for (const r of RULES) {
    const hits = r.check(ctx) || [];
    if (hits.length) ids.push(r.id);
  }
  return { ids, eff, ctx };
}

function cli(args, input) {
  try {
    const stdout = execFileSync(process.execPath, [BIN].concat(args), {
      encoding: 'utf8',
      input: input || '',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status === undefined ? 99 : e.status, stdout: (e.stdout || '') + (e.stderr || '') };
  }
}

console.log('\nclaimlint self-test\n');

console.log('  正样本（应当零误报）');
check('good.md 不产生任何问题', () => {
  const r = load('good.md');
  assert.deepStrictEqual(r.ids, [], '误报了：' + r.ids.join(', '));
});

console.log('\n  埋雷样本（应当全部命中）');
check('bad.md 命中全部 8 条规则', () => {
  const r = load('bad.md');
  const all = RULES.map((x) => x.id);
  const missing = all.filter((id) => !r.ids.includes(id));
  assert.strictEqual(missing.length, 0, '漏报：' + missing.join(', '));
});
check('bad.md 有效行数超过 30，长度门槛成立', () => {
  assert.ok(load('bad.md').eff >= 30, '实际 ' + load('bad.md').eff + ' 行');
});

console.log('\n  命令行行为');
check('good.md 退出码 0', () => {
  assert.strictEqual(cli([path.join(FIX, 'good.md')]).code, 0);
});
check('bad.md 退出码 1', () => {
  assert.strictEqual(cli([path.join(FIX, 'bad.md')]).code, 1);
});
check('--strict 下 warning 也返回 1', () => {
  const r = cli([path.join(FIX, 'bad.md'), '--strict']);
  assert.strictEqual(r.code, 1);
});
check('--json 输出可被解析', () => {
  const r = cli([path.join(FIX, 'bad.md'), '--json']);
  const j = JSON.parse(r.stdout);
  assert.strictEqual(j.tool, 'claimlint');
  assert.ok(j.files[0].issues.length >= 8);
});
check('--rules 只跑指定规则', () => {
  const r = cli([path.join(FIX, 'bad.md'), '--json', '--rules', 'missing-limits']);
  const j = JSON.parse(r.stdout);
  assert.ok(j.files[0].issues.every((i) => i.rule === 'missing-limits'));
});
check('--list 能列出 8 条规则', () => {
  const r = cli(['--list']);
  assert.strictEqual(r.code, 0);
  assert.ok(r.stdout.includes('missing-limits'));
});
check('stdin 输入可用', () => {
  const r = cli(['-', '--json'], fs.readFileSync(path.join(FIX, 'bad.md'), 'utf8'));
  const j = JSON.parse(r.stdout);
  assert.ok(j.files[0].issues.length > 0);
});
check('--version 打印版本号', () => {
  assert.ok(/^\d+\.\d+\.\d+/.test(cli(['--version']).stdout.trim()));
});
check('没有参数时返回用法错误码 2', () => {
  assert.strictEqual(cli([]).code, 2);
});
check('文件不存在时返回 1 而不是崩溃', () => {
  assert.strictEqual(cli(['no-such-file.md']).code, 1);
});

console.log('\n  边界输入');
check('空文件不崩溃', () => {
  const r = cli(['-', '--json'], '');
  assert.strictEqual(r.code, 0);
});
check('只有标题的文件不崩溃', () => {
  const r = cli(['-', '--json'], '# 只有一个标题\n');
  assert.strictEqual(JSON.parse(r.stdout).files[0].issues.length, 0);
});
check('未闭合代码围栏不崩溃', () => {
  const r = cli(['-', '--json'], '```\n没有闭合\n');
  assert.strictEqual(r.code, 0);
});
check('引号内的断言不判定', () => {
  const md = '「已通过全部检查项，可以交付」\n\n这一句是引用，不是断言。\n';
  const r = cli(['-', '--json', '--rules', 'unsupported-certainty'], md);
  assert.strictEqual(JSON.parse(r.stdout).files[0].issues.length, 0);
});
check('表格行不参与块级判定', () => {
  const md = '| 规则 | 说明 |\n|---|---|\n| x | 跳过了但没说后果 |\n';
  const r = cli(['-', '--json', '--rules', 'silent-skip'], md);
  assert.strictEqual(JSON.parse(r.stdout).files[0].issues.length, 0);
});
check('ignore-next 注释跳过下一块', () => {
  const md = '<!-- claimlint:ignore-next -->\n已通过全部检查项。\n';
  const r = cli(['-', '--json', '--rules', 'unsupported-certainty'], md);
  assert.strictEqual(JSON.parse(r.stdout).files[0].issues.length, 0);
});
check('纯英文文档不崩溃', () => {
  const r = cli(['-', '--json'], '# Report\n\nAll tests passed.\n');
  assert.ok(JSON.parse(r.stdout).files[0]);
});

console.log('');
if (failures.length) {
  console.log(`  ${failures.length} failed, ${pass} passed\n`);
  process.exit(1);
}
console.log(`  ${pass}/${pass} passed\n`);
process.exit(0);
