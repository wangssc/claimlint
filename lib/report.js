'use strict';

const useColor =
  !process.env.NO_COLOR &&
  process.argv.indexOf('--no-color') === -1 &&
  (process.stdout.isTTY || process.env.FORCE_COLOR);

const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
  green: '\x1b[32m',
};

function paint(code, s) {
  return useColor ? code + s + C.reset : s;
}

const LEVEL_COLOR = { error: C.red, warning: C.yellow, note: C.blue };
const LEVEL_LABEL = { error: 'error', warning: 'warning', note: 'note' };

function detectLang(text) {
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const latin = (text.match(/[A-Za-z]/g) || []).length;
  return cjk / (cjk + latin + 1) > 0.15 ? 'zh' : 'en';
}

function pad(s, n) {
  const width = [...s].length;
  return s + ' '.repeat(Math.max(0, n - width));
}

function renderText(results, lang, opts) {
  const L = {
    zh: {
      clean: '没有发现问题。',
      summary: (e, w, n) => `${e} error   ${w} warning   ${n} note`,
      lines: (n) => `${n} 行`,
      fatal: '无法读取',
    },
    en: {
      clean: 'Nothing to report.',
      summary: (e, w, n) => `${e} error   ${w} warning   ${n} note`,
      lines: (n) => `${n} lines`,
      fatal: 'cannot read',
    },
  }[lang];

  const out = [];
  const total = { error: 0, warning: 0, note: 0 };
  out.push('');
  out.push('  ' + paint(C.bold, 'claimlint') + paint(C.gray, '  v' + require('../package.json').version));

  for (const r of results) {
    if (r.error) {
      out.push(paint(C.red, `${r.file}: ${L.fatal} ${r.error}`));
      total.error += 1;
      continue;
    }
    const issues = r.issues;
    const counts = { error: 0, warning: 0, note: 0 };
    for (const i of issues) counts[i.level] += 1;
    total.error += counts.error;
    total.warning += counts.warning;
    total.note += counts.note;

    out.push('');
    out.push(paint(C.bold, r.file) + paint(C.gray, `   ${L.lines(r.effLines)}`));
    if (issues.length === 0) {
      out.push('  ' + paint(C.gray, L.clean));
      continue;
    }
    for (const i of issues) {
      const loc = i.line ? `${i.line}:1` : 'file';
      out.push(
        '  ' +
          paint(C.gray, pad(loc, 8)) +
          paint(LEVEL_COLOR[i.level], pad(LEVEL_LABEL[i.level], 9)) +
          paint(C.cyan, i.rule)
      );
      if (i.sample) out.push('  ' + paint(C.gray, '      | ') + paint(C.dim, i.sample));
      out.push('  ' + paint(C.gray, '      | ') + i.title);
      out.push('  ' + paint(C.gray, '      + ') + paint(C.dim, i.fix));
    }
  }

  out.push('');
  const sum = L.summary(total.error, total.warning, total.note);
  out.push('  ' + (total.error > 0 ? paint(C.red, sum) : total.warning > 0 ? paint(C.yellow, sum) : paint(C.green, sum)));
  return out.join('\n');
}

function renderJson(results) {
  return JSON.stringify(
    {
      tool: 'claimlint',
      version: require('../package.json').version,
      files: results.map((r) => ({
        file: r.file,
        error: r.error || null,
        issues: r.issues || [],
        summary: (r.issues || []).reduce(
          (a, i) => ((a[i.level] += 1), a),
          { error: 0, warning: 0, note: 0 }
        ),
      })),
    },
    null,
    2
  );
}

module.exports = { renderText, renderJson, detectLang, useColor, C, paint };
