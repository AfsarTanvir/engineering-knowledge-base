# Installing and Authenticating

Installing a coding agent takes one command. The part that goes wrong is
quieter: an old `ANTHROPIC_API_KEY` exported in your `~/.bashrc` from a weekend
experiment, which silently takes priority over the subscription you just paid
for — and you find out from the bill. Ten minutes of care now avoids that.

This file installs Claude Code on an Ubuntu-like Linux machine, logs it in,
adds the VS Code extension and checks everything works.

> **📌 In one line:** install with the native installer, log in with one
> method on purpose, confirm with `claude --version`, `claude doctor` and
> `/status` which account you are really using, then add the VS Code extension.

## Table of Contents

1. [Requirements](#requirements)
2. [Install: the Native Installer](#install-the-native-installer)
3. [Alternative: Install with npm](#alternative-install-with-npm)
4. [Authentication Options](#authentication-options)
5. [The API Key That Overrides Your Subscription](#the-api-key-that-overrides-your-subscription)
6. [The VS Code Extension](#the-vs-code-extension)
7. [Verifying, Updating, Troubleshooting](#verifying-updating-troubleshooting)
8. [Common Mistakes](#common-mistakes)
9. [Questions to Test Yourself](#questions-to-test-yourself)
10. [Related](#related)

---

## Requirements

At the time of writing (2026), the official
[setup page](https://code.claude.com/docs/en/setup) lists Ubuntu 20.04+,
Debian 10+ or Alpine 3.19+ on Linux (macOS 13+ and Windows 10 1809+ are also
supported), **4 GB of RAM or more**, and an internet connection — the model
runs on remote servers, not on your laptop. Git is optional but strongly
recommended; file 04 shows why.

You also need something that pays for usage: a Claude subscription or an
Anthropic Console account with API credit.

---

## Install: the Native Installer

The recommended way on Linux, macOS and WSL is the native installer:

```bash
curl -fsSL https://claude.ai/install.sh | bash
```

`curl | bash` runs a script from the internet with your user's permissions.
That is normal for developer tools, but it is still a trust decision. To read
what you are about to run first:

```bash
curl -fsSL https://claude.ai/install.sh -o install-claude.sh
less install-claude.sh && bash install-claude.sh
```

The installer puts the `claude` binary in `~/.local/bin` and its data in
`~/.local/share/claude`. Native installs **update themselves in the
background**. To follow the more conservative release channel instead of the
latest one:

```bash
curl -fsSL https://claude.ai/install.sh | bash -s stable
```

> **💡 Tip:** apt, dnf and apk repositories are documented on the setup page if
> you prefer a package manager. Homebrew (`brew install --cask claude-code`)
> also works but does not auto-update — you run `brew upgrade claude-code`.

---

## Alternative: Install with npm

npm is still supported. It needs **Node.js 22 or newer** and installs the
same native binary:

```bash
node --version                               # must be v22 or later
npm install -g @anthropic-ai/claude-code
npm install -g @anthropic-ai/claude-code@latest   # later, to upgrade
```

> **⚠️ Warning:** never `sudo npm install -g`. It runs package install scripts
> as root and leaves root-owned files behind. If a global install fails with
> `EACCES`, fix npm's global prefix or use a Node version manager such as nvm.

Pick **one** method. Two copies on your `PATH` means you never know which ran.

---

## Authentication Options

Claude Code needs to know who pays. There are four ways; you need one.

| Method | How | Who it is for | How you pay |
|---|---|---|---|
| **Subscription login** | Run `claude`, log in in the browser | Anyone on a Claude plan (Pro, Max, Team, Enterprise…) | Your plan, with usage limits |
| **Console API key** | Set `ANTHROPIC_API_KEY` | Pay-as-you-go, scripts, the Agent SDK | Per token, to the Console account |
| **Cloud provider** | `CLAUDE_CODE_USE_BEDROCK=1`, `CLAUDE_CODE_USE_VERTEX=1` or `CLAUDE_CODE_USE_FOUNDRY=1` | Companies buying models through AWS, Google Cloud or Microsoft | Your cloud bill |
| **Long-lived token** | `claude setup-token`, then `CLAUDE_CODE_OAUTH_TOKEN` | CI pipelines on a subscription (Part 7) | Your plan |

On a personal machine, the subscription login is the simplest (illustrative):

```text
$ cd ~/code/saas-api
$ claude
  (a browser window opens; you log in and approve; the session starts)

$ claude auth status          # later, from any terminal: who am I logged in as?
```

You can also use `claude auth login` / `claude auth logout` from the shell, or
`/login` / `/logout` inside a session. If you use an API key instead, export
it; the first interactive session that sees it asks you once to approve it.

---

## The API Key That Overrides Your Subscription

When several credentials are present, Claude Code uses the first one in this
order (highest first):

1. Cloud provider variables (`CLAUDE_CODE_USE_BEDROCK` and friends)
2. `ANTHROPIC_AUTH_TOKEN`
3. `ANTHROPIC_API_KEY`
4. An `apiKeyHelper` script from settings
5. `CLAUDE_CODE_OAUTH_TOKEN`
6. Your `/login` subscription credentials

Your subscription is **last**. If `ANTHROPIC_API_KEY` is exported anywhere —
`~/.bashrc`, `~/.profile`, a shell where you sourced a project's `.env` —
sessions bill that key per token instead of using your plan.

```text
$ env | grep -E '^(ANTHROPIC|CLAUDE_CODE)_'
ANTHROPIC_API_KEY=sk-ant-...          ← this wins over your subscription

$ grep -n ANTHROPIC ~/.bashrc ~/.profile 2>/dev/null
/home/afsar/.bashrc:58:export ANTHROPIC_API_KEY=sk-ant-...

$ unset ANTHROPIC_API_KEY             # this shell only; delete the line in ~/.bashrc too
```

> **⚠️ Warning:** if a session asks whether to use an API key you did not
> expect, say no and find where it came from. Run `/status` and check the
> account line every time you change your setup.

---

## The VS Code Extension

The extension puts Claude Code inside the editor: inline diffs, plan review,
@-mentions of files, and several conversations side by side.

1. In the Extensions view, search **"Claude Code"** and install the one from
   Anthropic (ID `anthropic.claude-code`). It needs VS Code 1.94.0 or newer.
2. Open `saas-api` as a folder and open the Claude Code panel.

| Action | Linux / Windows | macOS |
|---|---|---|
| Focus the Claude input | `Ctrl+Esc` | `Cmd+Esc` |
| Open in a new tab | `Ctrl+Shift+Esc` | `Cmd+Shift+Esc` |
| Insert an @-mention | `Alt+K` | `Option+K` |

The extension **bundles its own copy** of the CLI; the `claude` command in your
terminal is a separate install. Both share session history, so a conversation
started in one can be resumed with `claude --resume`. This track uses the
terminal for sessions and VS Code for reading diffs; every concept works in both.

---

## Verifying, Updating, Troubleshooting

```text
$ claude --version
X.Y.Z (Claude Code)          ← illustrative; any version means the binary runs

$ claude doctor
  (read-only diagnostics of the install, config and updater; no session starts)
```

Inside a session, `/doctor` does the same, and `/status` shows version, model,
**account** and setting sources. Confirm the account is the one you meant.

| Task | How |
|---|---|
| Update now | `claude update` (native installs also auto-update) |
| Choose a channel | `"autoUpdatesChannel": "stable"` or `"latest"` (default) in settings |
| Turn off auto-update | `"env": { "DISABLE_AUTOUPDATER": "1" }` in settings |
| Uninstall (native) | `rm -f ~/.local/bin/claude` and `rm -rf ~/.local/share/claude` |

| Symptom | Likely cause | Fix |
|---|---|---|
| `claude: command not found` | `~/.local/bin` not on `PATH`, or shell not reloaded | Open a new terminal; `echo $PATH` |
| npm fails with `EACCES` | Global npm prefix owned by root | Fix the prefix or use nvm; never `sudo` |
| Billed per token unexpectedly | `ANTHROPIC_API_KEY` set somewhere | `env \| grep ANTHROPIC`, remove it, check `/status` |
| Login fails on a headless/SSH machine | No browser available | See the [authentication docs](https://code.claude.com/docs/en/authentication) |
| Two different versions appear | Two install methods | `which -a claude`; keep one |

---

## Common Mistakes

| Mistake | Why it is wrong | Do this instead |
|---|---|---|
| Leaving `ANTHROPIC_API_KEY` exported "for later" | It overrides your subscription and bills per token | Export it only where needed; check `/status` |
| `sudo npm install -g` | Runs install scripts as root, breaks file ownership | Native installer, or fix the npm prefix |
| Installing with two methods | You cannot tell which binary or version runs | One method; `which -a claude` to check |
| Expecting the VS Code extension to give you `claude` in the terminal | It bundles its own copy only | Install the CLI separately |
| Skipping `claude doctor` | Small problems appear later as confusing behaviour | Run it after install and after big changes |

---

## Questions to Test Yourself

1. You logged in with your Max subscription, but the Console shows API charges
   from today. List the steps to find out why.
2. Which credentials does your subscription lose to, and why does the order
   exist at all?
3. A teammate runs `sudo npm install -g @anthropic-ai/claude-code`. What do you
   tell them, and what do you suggest instead?
4. You installed the VS Code extension, but `claude` in the terminal says
   "command not found". Explain why.
5. What does `claude doctor` tell you that `claude --version` does not?
6. Why might you download `install.sh` and read it before running it?

---

## Related

- [Your First Session](02-your-first-session.md) — what to do once it runs.
- [Permissions and Modes](03-permissions-and-modes.md) — read before you
  approve anything.
- [Settings and Permission Rules](../06-customising-your-agent/01-settings-and-permission-rules.md)
  — where `autoUpdatesChannel` and `env` live.
- [Cost Models and Limits](../07-advanced/04-cost-models-and-limits.md) —
  subscription limits versus per-token billing.
- [Logs, Disks and Debugging — Part 2](../../linux-and-deployment/01-linux-essentials/05-logs-disks-and-debugging-part-2.md#environment-variables-on-a-server)
  — how environment variables reach a process.
- [Secrets and Configuration — Part 1](../../backend-fundamentals/11-api-security/05-secrets-and-configuration-part-1.md)
  — treat API keys like any other secret.
- Official docs: [setup](https://code.claude.com/docs/en/setup),
  [authentication](https://code.claude.com/docs/en/authentication),
  [VS Code](https://code.claude.com/docs/en/vs-code).
