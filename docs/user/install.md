# Install Moonfold

Moonfold runs coding agents on your computer and lets you control them from its
desktop app or a web browser. Set up the machine where the agents will work first.

## Requirements

You need an installed, authenticated provider before starting a thread. You can
launch Moonfold and configure providers afterwards.

## Command line

```bash
curl -fsSL https://raw.githubusercontent.com/Mr-Dark-debug/Moonfold/main/scripts/install.sh | sh
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/Mr-Dark-debug/Moonfold/main/scripts/install.ps1 | iex
```

This installs the `moonfold` binary to `~/.local/bin`. If your shell reports `command not found`
afterwards, that directory is not on your `PATH` yet; the installer prints the
line to add. Set `MOONFOLD_VERSION` to pin an exact version, for example
`MOONFOLD_VERSION=0.1.0-beta.1`.

| Task                                             | Command                                                                       |
| ------------------------------------------------ | ----------------------------------------------------------------------------- |
| Start the server and open the web app            | `moonfold`                                                                    |
| Start the server without a browser               | `moonfold serve`                                                              |
| Use it from your other devices                   | `moonfold up` ([details](./remote-access.md))                                 |
| Keep it running in the background (macOS, Linux) | `moonfold service install` ([details](./background-service.md))               |
| Move to the newest release                       | `moonfold update`                                                             |
| Reclaim database space                           | `moonfold doctor` ([details](./background-service.md#reclaim-database-space)) |
| Remove it again                                  | `moonfold uninstall`                                                          |

Run `moonfold help` or `moonfold --help` for the full reference. To start in a new working
directory, use an explicit path such as `moonfold ./my-project`. A bare directory name
is accepted only if it already exists.

If `moonfold` or `moonfold start` reports an already running server, connect to that server
instead. Stop it before starting a replacement, or use a different `--base-dir`
for an independent server.

### Intel Macs

There is no `moonfold` executable for Intel Macs (the desktop app is available). To
run a server there, build it from source with `vp`, which provides the Node version it needs
([Install vp](https://github.com/Mr-Dark-debug/Moonfold#install-vp)):

```bash
git clone https://github.com/Mr-Dark-debug/Moonfold
cd moonfold && vp i && vp run build:desktop
node apps/server/dist/bin.mjs
```

`moonfold update` and the background service do not apply to a server run this way;
update it with `git pull` and a rebuild.

## Desktop app

Download a release from [GitHub Releases](https://github.com/Mr-Dark-debug/Moonfold/releases).
On Debian and Ubuntu, install the `.deb` with `sudo apt install ./Moonfold-*.deb`. Each release
has a `SHA256SUMS` file if you want to check a download.

### Opening an unsigned build

Beta builds are not code-signed yet, so the first launch shows a warning:

- **macOS:** open the `.dmg` and drag Moonfold to Applications. The first time, Control-click
  the app in Applications and choose **Open**, then **Open** again. If macOS only offers to move
  it to the Bin, open **System Settings → Privacy & Security**, find the note about Moonfold,
  and choose **Open Anyway**.
- **Windows:** SmartScreen shows "Windows protected your PC". Choose **More info**, then
  **Run anyway**.
- **Linux:** make the AppImage executable (`chmod +x Moonfold-*.AppImage`) and run it, or install
  the `.deb`.

You only need to do this once per install; updates open normally.

The `.deb` updates itself like the other desktop builds. It asks for your
password to install each update. If your desktop has no password prompt, the
update fails. Download the new `.deb` and install it the same way.

The AUR packages currently support x86_64 only; on ARM64, use the AppImage.
Update AUR installs with your AUR helper, such as `yay -Syu`, instead of the
in-app updater.

### Nix (nixpkgs)

Moonfold is maintained in [nixpkgs](https://github.com/NixOS/nixpkgs/tree/nixos-unstable/pkgs/by-name/moonfold/moonfold).
The command above installs from `nixos-unstable` and requires Nix 2.30 or later with
`nix-command` and `flakes` enabled. Launch the desktop app with `moonfold-desktop`;
the package also includes the `moonfold` command.

On NixOS, you can instead add the package to your system configuration, using
a nixpkgs revision that includes `moonfold`:

```nix
environment.systemPackages = [ pkgs.moonfold ];
```

Apply the change with `sudo nixos-rebuild switch`. For Home Manager, add
`pkgs.moonfold` to `home.packages` and run `home-manager switch`.

Update a profile installation with `nix profile upgrade moonfold`. For NixOS or
Home Manager, update your configuration's nixpkgs input or channel and rebuild.
Nix manages both the desktop app and the bundled
`moonfold` command; use Nix to update them instead of the in-app updater or `moonfold update`.

### The `moonfold` command

The desktop app includes the `moonfold` command-line tool. To run it from any
terminal, open **Settings → About** and choose **Install** next to
**moonfold command**. On macOS and Linux it adds a `moonfold` link to a folder on your
`PATH`; on Windows it adds the app's command folder to your `PATH`. Open a new
terminal afterwards. **Remove** takes it off again. If you already have `moonfold`
from npm, it stays as it is.

### Windows Subsystem for Linux

Choose a WSL distro in **Settings → Sharing & access** to run agents and projects
there. Install the provider CLIs inside that distro. Moonfold installs its own
server runtime there automatically; the first launch after an app update can
take longer.

### Open a project from a terminal

With the desktop app already running on the same machine:

```bash
moonfold app
```

This opens a new thread for the current directory, adding the project if needed.
Pass a path, such as `moonfold app ../my-project`, to open another directory. It requires
the desktop app, so a standalone server or an SSH session is not enough. If the
command cannot reach the app, start or update the desktop app and try again.

## Providers

Open **Settings → Providers** in the web or desktop app, select the environment,
and enable the provider you want. Installation, login, and configuration belong
to that environment's machine, even when you connect from a phone or another
computer.

| Provider         | Install and authenticate                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex            | [Connect with ChatGPT](./providers-codex.md#connect-with-chatgpt), or install [Codex CLI](https://developers.openai.com/codex/cli) and run `codex login`. |
| Claude           | Install [Claude Code](https://claude.com/product/claude-code), then run `claude auth login`.                                                              |
| Cursor           | Install [Cursor CLI](https://cursor.com/cli), then run `agent login`.                                                                                     |
| Grok Build       | Install [Grok Build CLI](https://x.ai/cli), then run `grok login`.                                                                                        |
| Kiro             | Install [Kiro CLI](https://kiro.dev/docs/cli/), then run `kiro-cli login`.                                                                                |
| OpenCode         | Install [OpenCode](https://opencode.ai), then run `opencode auth login`.                                                                                  |
| Antigravity      | Install and sign in with Google from Moonfold's provider settings.                                                                                        |
| Pi               | Install [Pi](./providers-pi.md#set-up-pi) with Node.js 22.19 or newer, then run `pi` and `/login`.                                                        |
| Muse Code        | Install [Muse Code](https://dev.meta.ai/docs/muse-code) on the server, run `muse login`, then enable it in Settings → Providers.                          |
| fx               | Install [fx](https://fx.sh) with `curl -fsSL https://fx.sh/setup.sh \| bash`, then run `fx login`.                                                        |
| DeepSeek Harness | Add it from the agent search in Settings → Providers, then give it a model; see [DeepSeek Harness](./providers-deepseek-harness.md).                      |

Provider CLIs must be on the server's `PATH`. If Moonfold cannot find one, set its
**Binary path** in provider settings, especially when using a version manager.
Cursor's executable is `cursor-agent`, although its login command is
`agent login`. Codex connected through ChatGPT and Antigravity can use their
managed runtimes without a `PATH` entry.

Moonfold warns when a provider version has known compatibility problems with your
release. Check **Settings → Providers** on that environment for the recommended
version or range. When its package manager supports installing a specific version,
you can install the recommendation there. Otherwise use the provider's installer
on the environment's machine. An unlisted version is unverified.

When a provider CLI is behind its latest release, its provider card shows the
available version. **Update now** runs the installer that owns the CLI
(Homebrew, or a global npm, pnpm, Yarn, Bun, Volta, or Vite+ install), or the
CLI's own update command when Moonfold cannot tell. Update a CLI installed with
mise through mise. Cursor and Antigravity update with Moonfold. Homebrew and
Chocolatey installs compare against the version their package manager offers,
which can trail the npm release; update Claude installed with Chocolatey
through Chocolatey.

Add another provider instance for a separate account or configuration. Each
instance can have its own environment variables, such as API keys or a custom
base URL. Mark secret values as sensitive; after saving, Moonfold does not display
their original values.

For provider-specific setup and accounts, see [Codex](./providers-codex.md),
[Claude](./providers-claude.md), [OpenCode](./providers-opencode.md),
[Antigravity](./providers-antigravity.md), [Kiro](./providers-kiro.md),
[Pi](./providers-pi.md), [Muse Code](./providers-muse.md), and [fx](./providers-fx.md).

## Next steps

- [Working with threads](./thread-sidebar.md): start tasks and organize parallel work.
- [Permission modes](./permission-modes.md): choose when agents ask before acting.
- [Remote access](./remote-access.md): connect from another device.
- [Running in the background](./background-service.md): keep a Linux or macOS host available.
- [Updating Moonfold](./updating.md): update the app and connected servers.
- [Managed policy](./managed-policy.md): configure Moonfold for everyone on a machine.
