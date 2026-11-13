# Running Moonfold in the background

On Linux and macOS, Moonfold can run as a service for your user so you do not need
to keep a terminal open.

## Manage the service

Install the `moonfold` CLI first ([Install Moonfold](./install.md#command-line)), then
run these commands on the machine that will host Moonfold:

| Task                                  | Command                      |
| ------------------------------------- | ---------------------------- |
| Set up access from your other devices | `moonfold up`                |
| See how your other devices reach it   | `moonfold status`            |
| Install and start                     | `moonfold service install`   |
| Inspect status and log location       | `moonfold service status`    |
| Move to a newer release               | `moonfold update`            |
| Restart                               | `moonfold service restart`   |
| Stop and remove from startup          | `moonfold service uninstall` |

Uninstalling the service leaves your projects, threads, and settings intact.
Running `moonfold service install` again repairs a service that `moonfold service status`
reports as broken.

`moonfold update` downloads the newest release on your channel and switches `moonfold`
and the service to it. Restarting interrupts running agent turns, terminals,
and remote clients, so it asks first; answer no and the service keeps running
the old version until you run `moonfold service restart`. Pass `--yes` from a
script. A server you started by hand is left running; stop and start it again
to pick up the new version. Wait for any remote update already in progress
before updating; to match a remote client's version, follow
[Updating Moonfold](./updating.md).

Pass an exact version (`moonfold update 0.0.42`) to pin one, `--channel nightly` to
switch to the Beta train (betas keep that name on the command line) or `--channel stable` back,
or `--allow-downgrade` to move backwards. `preview` is a
maintainers' test train: its builds can be broken and are never offered as
updates, so the installer and `moonfold update` ask for confirmation before
installing one.

`moonfold uninstall` removes the background service, the `moonfold` launcher, and the
downloaded versions after showing you the list and asking once. Your projects,
threads, and settings under `~/.moonfold/userdata` are kept, along with `service.env`
under Moonfold home. Pass `--yes` from a script.

## Local network access

A new service answers only on this machine. Other devices reach it directly once you
choose the local network in `moonfold up` (or run `moonfold up --lan`, which sets
`MOONFOLD_LAN=true` in `service.env`). It then listens on your local network and Tailscale
addresses, so the desktop and mobile apps on the same network connect directly. It still
does not answer on public addresses. Anyone on the same network can reach the port, so a
pairing code is all that keeps them out.

A service installed before `MOONFOLD_LAN` existed keeps listening on the local
network. `moonfold status` says so, and `moonfold up --no-lan` turns it off. Any
`MOONFOLD_HOST` value replaces this setting.

## Configure the service environment

Put custom environment variables in `service.env` under the service's Moonfold home
directory, normally `~/.moonfold/service.env`. This file survives service installation
and updates. For example:

```dotenv
MOONFOLD_PORT=3773
MOONFOLD_HOST=127.0.0.1
```

Use `KEY=VALUE` entries, quoting values that contain spaces or `#`. Values are
literal: shell commands and variable expansion are not evaluated. Entries
override the inherited service environment, except for `PATH`, `MOONFOLD_HOME`,
`MOONFOLD_BOOT_SERVICE_UNIT`, and `MOONFOLD_SERVICE_LAUNCHER_CONTEXT` (including case variants).

Run `moonfold service restart` after changing the file. Changes apply when the service
starts again; switching the server version alone keeps the current values.
For a service installed before env-file support, run `moonfold service install` once
with an up-to-date CLI.
A missing file is ignored; other read failures stop service startup.
If the file contains credentials, restrict access to that file with `chmod 600`
(for the default Moonfold home, `chmod 600 ~/.moonfold/service.env`).

## Platform support

Linux needs systemd user services. Setup enables lingering so Moonfold starts at
boot and keeps running after logout. If this needs administrator permission,
setup prints a recovery command before changing the service.

macOS starts the service when you log in and stops it when you log out. Keep the
Mac logged in and awake for unattended remote access. Installing over SSH while
nobody is logged in at the Mac's screen can fail at the final start step; the
service is still installed and will start at the next login.

Windows background services are not supported. To keep a Windows host available
through Moonfold Connect, leave the desktop app running with its local environment
enabled, or keep `moonfold serve` running in a terminal. Minimize the desktop app rather
than closing its last window, which stops its local server. Linking Moonfold Connect
does not configure automatic startup at Windows sign-in.

`moonfold up` installs the service when you set up Moonfold Connect, but the two are managed
separately. Signing out of Moonfold Connect does not stop or uninstall the service.

## Keep the server responsive when agents use all memory

On Linux, agents already run with lower priority than the server. When they
fill the machine's memory, though, the kernel may still slow down or stop the
server, because only an administrator can reserve memory for it. Run, as your
normal user:

```sh
moonfold service protect
```

It shows the system settings it will change, asks before applying them, and
then asks for your sudo password. If the machine runs Tailscale or SSH, it
also offers to protect them, so you can still reach the machine. Memory
protection takes effect at once. The server's protection from the kernel's
out-of-memory killer takes effect after `moonfold service restart`. `moonfold service status` reports whether
the protection is in place, and `moonfold service protect --undo` removes it.

## Troubleshooting

Start with `moonfold service status` on the host. It prints the log path and, on Linux,
checks whether the installed service is running, enabled, and allowed to survive
logout.

If it stops when your SSH session closes, check for `linger-disabled`. An
administrator can enable lingering with:

```sh
sudo loginctl enable-linger "$(id -un)"
```

Over SSH, allow sudo to prompt:

```sh
ssh -t your-server 'sudo loginctl enable-linger "$(id -un)"'
```

Then retry service setup as your normal user. Run only the `loginctl` command
with sudo; running Moonfold as root creates a separate installation and Connect
identity. Without administrator access, run `moonfold serve` in a terminal and keep
that session open.

| Status problem                          | Next step                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `linger-unavailable`                    | Run `loginctl show-user "$(id -un)" --property=Linger` and check that systemd-logind is available.                             |
| `user-manager-unavailable`              | Run `systemctl --user status` in a login session for the service user; check your distribution's systemd user-session support. |
| `service-disabled` or `service-stopped` | Read the log and `systemctl --user status moonfold.service`, then use the repair command printed by Moonfold.                  |
| `restart-pending`                       | A newer version is installed but the service still runs the previous one. Run `moonfold service restart`.                      |

On macOS, check **System Settings → General → Login Items** if the service no
longer starts at login. If agent work cannot access Desktop, Documents, or
Downloads, it may need Full Disk Access for the `moonfold` executable listed in
`ProgramArguments` in
`~/Library/LaunchAgents/dev.moonfold.app.service.plist`.

## Reclaim database space

Moonfold removes internal history older than a day on its own while it runs;
your conversations are kept. Databases created before this shrank automatically
still hold the freed space on disk until a one-time offline repair returns it
and turns on automatic shrinking. Settings > Maintenance (web and desktop) or
Settings > Maintenance (mobile) suggests the repair when at least 1 GiB can be
reclaimed.

Run `moonfold doctor` on the machine that hosts the environment. It reports the
database size and the space it can reclaim, then asks which repairs to run;
pass `--fix` to run the recommended ones without a prompt (for scripts), or
`--dry-run` to only report. An installed background service for the same data
directory is stopped for the repair and started again afterwards, also when
the repair fails. Quit a server you started by hand, or the desktop app, first:
the repair refuses to touch a database that is in use. Use `--base-dir` for a
different data directory.

The repair can take several minutes on a large database. It rebuilds the
database through a temporary copy, so it needs free space of about the
database's size twice over: once in the system temporary directory (`TMPDIR`
or `/tmp` on Linux and macOS) and once next to the database for its
write-ahead log.

If you upgraded from a version before 0.1.0, its database (`state.sqlite`) is
still kept next to the current one so you can roll back. `moonfold doctor` offers to
delete it, but never selects that repair for you and `--fix` skips it: once it
is gone, a version before 0.1.0 starts with no threads or settings.
