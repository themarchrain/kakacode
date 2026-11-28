# SYNC_FORK.md：与上游同步的标准流程

本文件写给执行同步的人，也写给 AI 助手。用户说「按 SOP 同步」时，助手按第 4 节到第 11 节自动执行，最后报告结果。

## 1. 仓库现状

本项目是 `pingdotgg/t3code` 的个人二开版本，目录名 `kakacode`。目标是逐步改造 UI，同时保持与官方版的数据兼容。

已改的部分：

- 会话详情卡的「上下文窗口」一行，改为 4 个图标格，每格带悬停浮层。
- 速率格在运行中和空闲时显示两套读数。

未改且不应改的部分：

- 产品名、appId、userData 目录、协议 scheme、CLI 名。
- 理由：官方版与本版共用同一份用户数据。改这些标识会让两者互不识别。

## 2. 远程仓库

| 名称       | 地址                                       | 用途        | 写入 |
| ---------- | ------------------------------------------ | ----------- | ---- |
| `origin`   | `https://github.com/themarchrain/kakacode` | 自己的 fork | 可写 |
| `upstream` | `https://github.com/pingdotgg/t3code`      | 原作者仓库  | 只读 |

推送凭据用 `gh` 登录的账号（`gh auth status` 可查看）。全局 git 配置里没有 GitHub 密码，所以推送时单次指定凭据助手，见第 10 节。

## 3. 约束

同步时遵守下列约束。每条都适用于全程。

- 不应向 `upstream` 推送分支，也不应开 PR。`upstream` 只用于 `fetch`。
- 不应改动官方版的 userData 目录（用户主目录下的 `.t3`）。该目录属于官方版。
- 不应同时运行两个 App。
- 新文案应走 i18n。中文不应写死在组件里。
- 提交风格沿用上游：`feat(web): ...` 或 `fix(web): ...`，不带 `(#编号)`。
- fork 的 GitHub Actions 已关闭。推送不会触发 CI。

## 4. 同步前检查

1. 运行 `git status --porcelain`。
2. 若输出只有 `?? .design/`，继续。若还有其他未提交改动，停止同步并询问用户。
3. 打回退标签：`git tag -f pre-sync-$(date +%Y%m%d) HEAD`。
4. 记录落后数量：`git rev-list --count HEAD..upstream/main`。

**注意：** 回退标签只保留一个，同日多次同步会覆盖前一个。

## 5. 取上游提交

运行：

```bash
git fetch --no-tags upstream main:refs/remotes/upstream/main
```

`--no-tags` 可省一次全量标签下载。直接 `git fetch upstream` 在本机曾报 `fetch-pack: invalid index-pack output`，加上 `main:refs/remotes/upstream/main` 后成功。

## 6. 试合并

试合并在临时 worktree 里做，不碰当前工作区。

```bash
git worktree add -q --detach ../kakacode-sync-probe HEAD
cd ../kakacode-sync-probe
git merge --no-commit --no-ff upstream/main
git diff --name-only --diff-filter=U     # 冲突文件清单
git merge --abort
cd -
git worktree remove --force ../kakacode-sync-probe
```

冲突文件清单为 0 时，进入第 7 节。有冲突时，按下表处理，然后进入第 7 节。

| 冲突文件                                | 处理                                               |
| --------------------------------------- | -------------------------------------------------- |
| `apps/web/src/i18n/translations/*.json` | 按第 8 节                                          |
| 其他文件                                | 按语义合并，保留两侧意图。无法判断时停止并询问用户 |

## 7. 合并

运行：

```bash
git merge upstream/main -m "chore: sync with upstream t3code"
```

## 8. 解决 i18n 冲突

10 个语言目录各有自己的 `apps/web/src/i18n/translations/<locale>.json`。这 10 个文件几乎每次同步都冲突，因为自有 key 与上游 key 都曾写在文件末尾。

1. 取上游整份：`git checkout --theirs -- apps/web/src/i18n/translations/<locale>.json`。
2. 把附录 A 的 25 个 key 插回文件顶部，紧跟第一行的 `{`。
3. 写入前校验：`JSON.parse` 通过；每个 key 只出现一次；除附录 A 的 key 和附录 B 的 6 个已删 key 外，文件内容与上游一致。
4. 重复 1 到 3，处理全部 10 个目录。

**警告：** 不应重新序列化这些 JSON。上游格式化器把小数组压成一行（如 `"c": [" ", "on the computer…"]`），`JSON.stringify` 会展开数组，产生几千行假 diff。

**警告：** 不应把这些 key 追加到文件末尾。上游一直往末尾追加新条目，两边的插入点相同，下次同步必然冲突。放在顶部后，上游的末尾追加碰不到它们。

**警告：** 插入前应确认 key 不与上游重复。JSON 允许多个同值 key，后一个覆盖前一个，不会报错。上一次同步因此把德语目录的 `95435f0b59cb2193`（`Audiovorschau`）覆盖成英文 `Audio preview`。

**注意：** 不应运行 `pnpm i18n:generate`。该命令重排整个目录，会产生约 2300 行假 diff。新增 key 应手工写入，或按第 8 节第 2 步插回。

## 9. 依赖与验证

锁文件变化时先装依赖：

```bash
pnpm install
```

若本机 pnpm 的全局 store 位于其他盘符，先设置 `npm_config_store_dir` 环境变量，再运行上面的命令。

依次运行下列检查。任一项失败时，先修问题，再重新运行该项。

```bash
# 类型检查（在 apps/web 下运行）
cd apps/web && ../../node_modules/.bin/effect-tsgo tsrs --noEmit

# lint（只检查改动文件即可）
../../node_modules/.bin/vp lint src/components/ChatView.tsx src/components/chat/

# 单元测试
../../node_modules/.bin/vp test run src/components/chat/contextRowMetrics.logic.test.ts src/lib/contextWindow.test.ts

# i18n 目录与源码对照（回到仓库根）
cd ../.. && pnpm i18n:check
```

`knip:check` 由提交钩子自动运行，不必单独调用。

预期结果：类型检查退出码为 0；lint 无输出；测试全部通过；`i18n:check` 输出 `i18n catalogs match the source`。

## 10. 推送

运行：

```bash
git -c credential.helper='!gh auth git-credential' push origin main
```

直接 `git push` 会失败，因为全局 `credential.helper=store` 里没有 GitHub 凭据。上面的写法只对本次命令生效，不改全局配置。

推送后校验：

```bash
git fetch origin
git rev-list --left-right --count origin/main...HEAD   # 期望 0	0
git rev-list --count HEAD..upstream/main               # 期望 0
```

## 11. 报告

同步完成后，向用户报告下列内容：

- 合并提交的哈希。
- 拉入的上游提交数量。
- 冲突文件清单，以及各文件的处理方式。
- 各项检查的结果。
- 回退标签名，以及回退命令。

回退命令：

```bash
git reset --hard pre-sync-<YYYYMMDD>
```

## 12. GitHub 网页的 Sync fork 按钮

该按钮在 GitHub 服务器上做三方合并。两边有冲突时，GitHub 拒绝同步并提示到本地解决。

**警告：** 不应点击 Sync fork 下拉菜单里的 `Discard commits`。该操作把分支重置到上游状态，本地全部提交会丢失。

按钮可用的条件：第 6 节的试合并结果为 0 冲突。2026-11-28 的实测结果：上游领先 175 个提交时，试合并为 0 冲突，按钮可用。

下列情况会让冲突重新出现：

- 自有改动与上游改到同一批行，例如 `ChatView.tsx`。
- 上游改动语言目录文件的第一行。
- 有人把自有 key 又追加到文件末尾。

## 附录 A：自有 i18n key 清单

这 25 个 key 是上下文行专用，上游没有。同步后应保留在 10 个语言目录中，位置在文件顶部。

| key                | 英文                             | 中文                        |
| ------------------ | -------------------------------- | --------------------------- |
| `b0fc9cee67836d0d` | Context: {percent}% used         | 上下文：已用 {percent}%     |
| `3afa8db7e1c959ac` | Context: {tokens} tokens used    | 上下文：已用 {tokens} token |
| `97734e41e9147c36` | {value} tokens per second        | 每秒 {value} token          |
| `f73276d6ba4e41c5` | Speed unavailable                | 速率不可用                  |
| `33760f8afbf087bf` | {value} tokens used this session | 本次会话已用 {value} token  |
| `25d0784e0849e7bf` | Session tokens unavailable       | 会话 token 不可用           |
| `9751f6e0c612a3af` | Cache hit rate {percent}%        | 缓存命中率 {percent}%       |
| `0d7ab44cdb6b53c3` | Cache hit rate unavailable       | 缓存命中率不可用            |
| `f88cf06f4ef7bfd5` | Used                             | 已用                        |
| `4807335287591bcf` | Limit                            | 上限                        |
| `2251d0033e3ed1a4` | Auto-compact                     | 自动压缩                    |
| `c8379dd06cb8afa2` | Cache hits                       | 缓存命中                    |
| `25a6a1fd4d019220` | Subagents and compaction         | 子代理与压缩                |
| `00d82ca2e8d691ec` | Total                            | 合计                        |
| `acceba746c71d8a5` | This session                     | 本会话                      |
| `9bf8e7d08559a6b0` | This turn                        | 本轮                        |
| `a6db9881784e85d0` | Cached                           | 命中缓存                    |
| `20b612a0474e1f6f` | Input total                      | 输入合计                    |
| `17554cfe5cad2ded` | Input tokens                     | 输入                        |
| `8435cf543bf90afc` | Output tokens                    | 输出                        |
| `a010a9bba1e250f9` | Session average                  | 会话平均                    |
| `001dec08c2317790` | Time                             | 用时                        |
| `ccbaf6abda4f1f00` | This turn's rate                 | 本轮速率                    |
| `20b80869866e0f9f` | Turn output                      | 本轮输出                    |
| `867ea5ab6dd29f69` | Turn time                        | 本轮用时                    |

德语目录中 `95435f0b59cb2193` 的值应为 `Audiovorschau`。该 key 属于上游，不是自有 key。

## 附录 B：已删除的陈旧 key

这 6 个 key 属于旧版上下文行。新组件不再引用它们，同步时不应写回。

| key                | 原英文                            |
| ------------------ | --------------------------------- |
| `83bbceecef0f6872` | Context                           |
| `d996426072afbeb2` | {used}% used                      |
| `ce0545a76897e406` | {usedTokens} tokens used          |
| `7c1d4c58aeb9e1b3` | Context: {used}% used             |
| `4214d97447ddd9e9` | Context: {usedTokens} tokens used |
| `66be4fb43249bbd2` | {used} of {max} tokens            |

`i18n:check` 报告这 6 个 key 为 stale 时，从 10 个目录删除。

## 附录 C：本地开发环境

```bash
# 启动开发服务，使用数据副本
pnpm dev --home-dir ../kaka-dev-home

# 服务端 127.0.0.1:13773，网页端 5733

# 签发配对 token
cd apps/server && node src/bin.ts auth pairing create --base-dir ../../kaka-dev-home --ttl 12h
```

`../kaka-dev-home` 是官方版数据目录的副本，放在仓库之外。开发时不应指向官方数据目录。

## 附录 D：试合并的实测记录

| 日期       | 上游领先数量 | 试合并冲突 |
| ---------- | ------------ | ---------- |
| 2026-11-28 | 175          | 0          |

冲突为 0 表示网页的 Sync fork 按钮可用。
