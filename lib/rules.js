'use strict';

const { hasEvidence, sectionText, effectiveLines } = require('./scan');

const CERTAIN = /(已验证|已通过|已测试|测试通过|全部通过|验证通过|确认无误|已确认|符合要求)/;
const CONCLUSION = /(全部通过|测试通过|验证通过|已通过|符合要求|可以交付|达标|没有问题|无异常|ready to ship)/i;
const FALSIFY = /(反证|推翻|证伪|失效|局限|限制|不适用|风险|未覆盖|已知问题|什么情况下|无法验证|不成立|falsif|limitation|known issue|caveat)/i;
const LIMIT_HEAD = /(局限|限制|已知问题|未覆盖|不适用|风险|什么情况下|已知缺陷|适用边界|limitation|known issue|caveat|scope)/i;
const VAGUE = /(大幅|显著|明显提升|明显改善|基本上|大致|众多|大量|极大地|很大程度上|substantially|significantly|roughly)/i;
const HEDGE = /(应该|大概|估计|可能|或许|推测|似乎|probably|might|may|guess)/i;
const SKIP = /(跳过|不支持|暂不|未实现|忽略|略过|留空|skipped|not supported|out of scope)/i;
const SKIP_OK = /(未评估|不在范围|风险|后续|原因|因为|已知|下一步|TODO|详见|见附录|如下|附录|not assessed|because|reason)/i;
const NEXT = /(下一步|后续|接着|回退|如果失败|补救|重跑|重测|待办|TODO|next step|rollback|retry)/i;
const ANCHOR = /(v\d+\.\d+\.\d+|版本号|commit|sha256|hash|哈希|[0-9a-f]{7,40})/i;

function snippet(line) {
  const t = (line || '').replace(/\s+/g, ' ').trim();
  return t.length > 72 ? t.slice(0, 72) + '…' : t;
}

const RULES = [
  {
    id: 'unsupported-certainty',
    level: 'warning',
    title: { zh: '断言没有证据', en: 'Certainty without evidence' },
    why: {
      zh: '这一节出现了「已验证 / 已通过」这类话，但同一节里找不到命令、输出、数字、路径或链接。读者无法判断这是跑出来的还是写上去的。',
      en: 'This section claims something is verified, but contains no command, output, number, path or link. The reader cannot tell whether it was run or typed.',
    },
    fix: {
      zh: '把证据放进同一节：命令、关键输出、样本数。或者把措辞降级为「未运行」。',
      en: 'Put the evidence in the same section, or downgrade the wording to "not run".',
    },
    check(ctx) {
      const out = [];
      for (const b of ctx.blocks) {
        if (b.type === 'code' || b.type === 'heading' || b.type === 'table' || b.ignored) continue;
        if (!CERTAIN.test(b.clean)) continue;
        if (hasEvidence(sectionText(b.section))) continue;
        out.push({ line: b.line, sample: snippet(b.text) });
      }
      return out;
    },
  },
  {
    id: 'no-falsifier',
    level: 'error',
    title: { zh: '只有正面证据，没有反证', en: 'Conclusions without a falsifier' },
    why: {
      zh: '全文给了「通过」类结论，但没有任何一处写出什么能推翻它。只有正面证据的判断不叫判断，叫立场。',
      en: 'The document concludes something passes, but never states what would overturn that. Positive evidence alone is a position, not a finding.',
    },
    fix: {
      zh: '填三格：什么能推翻它 / 我去哪儿找了 / 找到没有。「找不到」必须附上找过的清单。',
      en: 'Fill three fields: what would overturn it / where I looked / found or not. "Not found" must list where you looked.',
    },
    check(ctx) {
      if (ctx.effLines < 15) return [];
      if (!CONCLUSION.test(ctx.clean)) return [];
      if (FALSIFY.test(ctx.clean)) return [];
      const b = ctx.blocks.find((x) => x.type !== 'code' && !x.ignored && CONCLUSION.test(x.clean));
      return [{ line: b ? b.line : 1, sample: b ? snippet(b.text) : '' }];
    },
  },
  {
    id: 'missing-limits',
    level: 'error',
    title: { zh: '没有「什么情况下是错的」', en: 'Missing limits section' },
    why: {
      zh: '文档超过 30 行，却没有一节交代局限、未覆盖范围或失效条件。下一个人拿到它，不知道该在哪里多看一眼。',
      en: 'The document is longer than 30 lines but never states its limits or coverage gaps. The next reader does not know where to look harder.',
    },
    fix: {
      zh: '加一节：这份东西什么情况下是错的、错了先看哪里。不是免责声明，是路线图。',
      en: 'Add a section: when this is wrong, and where to look first. Not a disclaimer — a route map.',
    },
    check(ctx) {
      if (ctx.effLines < 30) return [];
      const has = ctx.blocks.some((b) => b.type === 'heading' && LIMIT_HEAD.test(b.clean));
      return has ? [] : [{ line: 0, sample: '' }];
    },
  },
  {
    id: 'vague-without-number',
    level: 'warning',
    title: { zh: '程度词没有数字', en: 'Vague magnitude, no number' },
    why: {
      zh: '出现了「大幅 / 显著 / 基本上」这类程度词，但同一段里没有数字。程度词是结论里最贵的一个字，它必须能落到数上。',
      en: 'A magnitude word appears without any number in the same paragraph. A magnitude claim is the most expensive word in a conclusion; it has to land on a number.',
    },
    fix: { zh: '换成具体数字，或者删掉这个词。', en: 'Replace with a number, or delete the word.' },
    check(ctx) {
      const out = [];
      for (const b of ctx.blocks) {
        if (b.type === 'code' || b.type === 'table' || b.ignored) continue;
        if (!VAGUE.test(b.clean)) continue;
        if (/\d/.test(b.clean)) continue;
        out.push({ line: b.line, sample: snippet(b.text) });
      }
      return out;
    },
  },
  {
    id: 'mixed-confidence',
    level: 'error',
    title: { zh: '同一处既猜又断言', en: 'Hedge and assertion in one place' },
    why: {
      zh: '同一段里既有「应该 / 可能 / 估计」，又有「已验证 / 已通过」。这是在用一个不确定的依据支撑一个确定的结论。',
      en: 'The same paragraph hedges and asserts at once. An uncertain basis is being used to support a certain conclusion.',
    },
    fix: { zh: '拆成两句：哪部分是实测，哪部分是推测，分开写。', en: 'Split it: what was measured, what was guessed.' },
    check(ctx) {
      const out = [];
      for (const b of ctx.blocks) {
        if (b.type === 'code' || b.type === 'table' || b.ignored) continue;
        if (HEDGE.test(b.clean) && CERTAIN.test(b.clean)) out.push({ line: b.line, sample: snippet(b.text) });
      }
      return out;
    },
  },
  {
    id: 'silent-skip',
    level: 'warning',
    title: { zh: '跳过了但没说后果', en: 'Skipped without consequence' },
    why: {
      zh: '文档承认某处跳过或没支持，但没写这意味着什么。读者会默认它没问题。',
      en: 'The document admits something was skipped but never says what that costs. Readers default to "fine".',
    },
    fix: { zh: '补一句：跳过意味着什么、风险在哪、谁该补。', en: 'Say what the skip costs, and who should close it.' },
    check(ctx) {
      const out = [];
      for (const b of ctx.blocks) {
        if (b.type === 'code' || b.type === 'table' || b.ignored) continue;
        if (!SKIP.test(b.clean)) continue;
        if (SKIP_OK.test(b.clean)) continue;
        out.push({ line: b.line, sample: snippet(b.text) });
      }
      return out;
    },
  },
  {
    id: 'approval-without-anchor',
    level: 'note',
    title: { zh: '批准没绑版本', en: 'Approval without an anchor' },
    why: {
      zh: '文档给了「通过」类结论，但没写这是对哪一版、哪一份内容通过的。改了文件以后，这句话还挂着。',
      en: 'The document approves something without saying which version. Edit the file and the approval still sits there.',
    },
    fix: { zh: '写上版本号或哈希：这里通过的是 v1.2 / sha256:ab12…', en: 'Pin it: this approval covers v1.2 / sha256:ab12…' },
    check(ctx) {
      if (ctx.effLines < 15) return [];
      if (!CONCLUSION.test(ctx.clean)) return [];
      if (ANCHOR.test(ctx.clean)) return [];
      return [{ line: 0, sample: '' }];
    },
  },
  {
    id: 'conclusion-without-next',
    level: 'note',
    title: { zh: '结论后面没有下一步', en: 'No next step after the conclusion' },
    why: {
      zh: '判断已经下了，但没写接下来谁做什么、失败了怎么办。下一个人得自己猜。',
      en: 'A verdict is given but nobody is told what happens next, or what to do if it fails.',
    },
    fix: { zh: '加一行：下一步谁做什么；如果这个判断错了，怎么退回来。', en: 'Add one line: who does what next, and how to back out.' },
    check(ctx) {
      if (ctx.effLines < 15) return [];
      if (!CONCLUSION.test(ctx.clean)) return [];
      if (NEXT.test(ctx.clean)) return [];
      return [{ line: 0, sample: '' }];
    },
  },
];

module.exports = { RULES, effectiveLines };
