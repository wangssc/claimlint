# claimlint

**Lint the claims, not the prose.**

给 AI 写的报告做 lint —— 查的不是文笔，是证据。

![tests](https://img.shields.io/badge/tests-20%2F20-brightgreen)
![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![network](https://img.shields.io/badge/network-none-lightgrey)
![node](https://img.shields.io/badge/node-%3E%3D18-blue)

---

AI 写出来的报告有一种固定的毛病：**读起来很完整，但没人敢拿它做决定。**

- 「全部通过」后面找不到任何一条命令输出
- 「已验证」没人知道验的是哪一版
- 「没有问题」里混着三处根本没扫到的格式
- 「性能大幅提升」，但没有数字

人看不出这些，因为它们不是语法错误，是**证据缺口**。语法检查器不管这个，模型评审又是拿模型判模型。

`claimlint` 用 8 条确定性规则找这些缺口。不调模型，不联网，零依赖，200ms 内出结果。

## 30 秒

```bash
npx claimlint report.md
```

真实输出（`test/fixtures/bad.md`，一份 AI 生成的安全评估报告）：

```text
  claimlint  v0.1.0

test/fixtures/bad.md   31 行
  5:1     error    no-falsifier
        | 系统整体符合要求，安全状况良好。已通过全部检查项，未发现明显缺陷，可以交付。
        | 只有正面证据，没有反证
        + 填三格：什么能推翻它 / 我去哪儿找了 / 找到没有。「找不到」必须附上找过的清单。
  18:1    warning  silent-skip
        | 扫描器跳过 3 个不支持的格式，其余文件全部完成解析。
        | 跳过了但没说后果
        + 补一句：跳过意味着什么、风险在哪、谁该补。
  28:1    error    mixed-confidence
        | 估计还有几处没测到，但已通过验收，可以进入下一阶段。
        | 同一处既猜又断言
        + 拆成两句：哪部分是实测，哪部分是推测，分开写。
  file    error    missing-limits
        | 没有「什么情况下是错的」
        + 加一节：这份东西什么情况下是错的、错了先看哪里。不是免责声明，是路线图。

  3 error   4 warning   2 note
```

换一份写得规矩的报告，输出是：

```text
  claimlint  v0.1.0

test/fixtures/good.md   22 行
  没有发现问题。

  0 error   0 warning   0 note
```

## 8 条规则

| 规则 | 级别 | 抓什么 | 反例 |
|---|---|---|---|
| `unsupported-certainty` | warning | 断言没有证据 | 「已测试通过」，但这一节里没有命令、输出、数字、路径或链接 |
| `no-falsifier` | error | 只有正面证据 | 列了十条没问题的理由，就宣布没问题 |
| `missing-limits` | error | 没有局限章节 | 三十行以上的报告，没一句说它什么时候会错 |
| `vague-without-number` | warning | 程度词没有数字 | 「安全性大幅提升」，同段没有任何数字 |
| `mixed-confidence` | error | 同一处既猜又断言 | 「估计还有几处没测到，但已通过验收」 |
| `silent-skip` | warning | 跳过了但没说后果 | 「扫描器跳过 3 个格式」，然后没了 |
| `approval-without-anchor` | note | 批准没绑版本 | 「已通过」，但没说是哪一版、哪一份 |
| `conclusion-without-next` | note | 结论后没有下一步 | 判完了，没人知道接下来谁做什么 |

`claimlint --list` 可以看全部，`--rules no-falsifier` 可以只跑一条。

## 为什么不调用模型

这是这个项目最需要解释的决定。用 GPT 判文档，一句话就能做，为什么要写 8 条正则？

1. **判官本身没人验证。** 用模型判模型，你没法再给判官配一个判官。同一个输入两次给出不同结果，这个结论就没法进 CI。
2. **不可复现。** 规则会误报，但误报是可复现、可修、可写进测试的。模型不会。
3. **上传即外发。** 把报告发给第三方 API，本身就是一次数据外发。对密评、审计、医疗这类场景，这是最不能接受的一步。
4. **成本不成比例。** 一件确定性规则能做的事，不值得付出千倍的时间和费用。

这个工具不试图理解你的文档。它只检查一件事：**该交代的东西交代了没有。**

## 用法

```bash
npx claimlint report.md                  # 单文件
npx claimlint docs/*.md                  # 多文件
cat report.md | npx claimlint -          # 标准输入
npx claimlint report.md --json           # 给 CI 或脚本用
npx claimlint report.md --strict         # warning 也算失败
npx claimlint --list                     # 列出全部规则
```

安装为全局命令：

```bash
npm i -g claimlint
```

### 接进 CI

```yaml
- name: claimlint
  run: npx claimlint docs/**/*.md --strict
```

退出码：`0` 没有 error；`1` 有 error（`--strict` 时 warning 也算）；`2` 用法错误。

## 这个项目自己也过一遍

`claimlint` 遵守自己定义的规矩，否则它没资格存在。

```bash
node test/run.js                              # 20/20 通过
node bin/claimlint.js README.md PROTOCOL.md   # 本仓库这两份文档自身检查
```

测试里有两条是关键的：

- `test/fixtures/bad.md` 埋了 8 个问题，要求 **8 条规则全部命中**。漏一条就算失败。
- `test/fixtures/good.md` 是干净样本，要求 **零误报**。

第二条比第一条难。开发过程中它抓出过一次真误报：安全报告里的「边界访问控制」被当成了局限词「边界」——同一份文档因此漏报了 `no-falsifier`。修法是把这个词从词表里去掉。

## 局限

- **只认 Markdown。** PDF 和 docx 要先转成文本，转换本身可能丢结构。
- **词表是硬编码的。** 中文和英文各一套。其他语种没有测过，无法给出识别率。
- **启发式，不是语义理解。** 它能判断「这句话旁边有没有证据」，不能判断「这个证据是不是真的」。后者它管不了。
- **会误报。** 「边界访问控制」那个例子已经修了，但同类撞词一定还会有。规则是可读的，看到了直接改 `lib/rules.js`。
- **引号内的文字不判定。** 中文「」、英文双引号、行内代码里的内容视为引用，不当作你自己的断言。表格行同理，因为表格是结构化对照，不是叙述。不加这条豁免，任何讲「怎么写报告」的文档都会被自己的工具判红。
- **不能替代人。** 它只保证该交代的都交代了，不保证交代的是真的。这一条是这份 README 里最重要的一句。

## 下一步

- [ ] 加 `--fix` 的建议模式：不自动改，只在原文里插入需要填的空
- [ ] 支持 `.docx` 的纯文本抽取（不引入 XML 之外的重依赖）
- [ ] 让规则词表可外置成 `.claimlintrc`，不改代码就能适配行业词汇

## 协议全文

8 条规则只是执行层。它们背后的判断标准写在 [PROTOCOL.md](PROTOCOL.md)——九条交付前自审协议，每条注明借鉴自哪个领域的方法：CIA 的分析标准、Heuer 的竞争性假设分析、Klein 的事前验尸、ISO/IEC 17025 的阳性对照、I-PASS 医疗交班。

工具能做一半，另一半只能人做。第 5 条（假设它已经错了）和第 0 条（每季度删一条规则）机器判不了。

## License

MIT
