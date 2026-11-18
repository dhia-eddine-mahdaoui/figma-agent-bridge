# Agent setup contract

If a person sends this GitLab or GitHub URL to a local Claude Code or Codex agent and asks
for setup, perform this recipe. Do not invent machine-specific installation commands.

## What to do

1. Clone the repository into a new folder, or download/extract its source release.
   Never reset, clean, or overwrite an existing checkout with local edits.
   Read this file and inspect the bootstrap before executing it.
2. Run the command below for the current client. Installation copies only the
   declared source files to `~/.figma-local-bridge`, installs a private Node runtime,
   installs the personal skill, and merges its own MCP entry with backups.
   The source checkout is not the runtime installation and can be moved afterward.
3. Read the JSON result. Run the installed `doctor.mjs` with the recorded runtime
   and `FIGMA_BRIDGE_DATA_DIR` from `installation.json` if further diagnostics are
   needed. A disconnected Figma plugin is expected before first pairing, not a
   failed software installation.
4. Tell the user the exact installed manifest path and guide the one-time Figma
   steps below. These are required by Figma; do not claim to have completed them
   without observing a connected plugin.
5. Restart/reload the AI client to discover the tools and skill. In the current
   terminal session, the installed CLI fallback works immediately.

### Windows (PowerShell)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\bootstrap.ps1 -Client claude-code
```

Use `-Client codex`, `-Client claude-desktop`, or `-Client both` (Claude Code +
Codex) as needed. ExecutionPolicy Bypass applies to this invocation only; the
installer does not change system policy. Organizational restrictions still apply.

### macOS / Linux

```sh
sh ./bootstrap.sh --client claude-code
```

Use `--client codex`, `--client claude-desktop` (macOS), or `--client both`.
Linux supports the companion and local terminal clients; an officially supported
Figma desktop app is available on Windows/macOS. Browser/plugin use on Linux is
not yet validated by this project.

No npm install, administrator privileges, global Node installation, API keys,
copied tokens, or external MCP relay is needed. Bootstrap downloads a pinned Node
24.19.0 archive from nodejs.org and verifies its SHA-256 against committed values.
It copies Node and its license to the permanent installation. Windows x64/ARM64
and macOS/Linux x64/ARM64 download recipes are included; see validation limits below.

### The unavoidable Figma steps (once)

In Figma, open a design file, choose **Plugins → Development → Import plugin from
manifest**, and select the installed `plugin/manifest.json` path printed by setup.
Run **Figma Agent Bridge (Local)**, click **Pair this computer**, then approve
**Allow local connection** on the local browser page. No plugin ID generation,
Community publishing, or key copying is needed.

For later sessions, open the target file and run the plugin. Leave it open while
the agent works. The companion starts automatically; saved pairing reconnects.

## SSH to WSL on another computer

Ask where Figma runs before constructing a Windows manifest path. Being connected
through SSH does not establish that WSL is local to the Figma computer.
`\\wsl.localhost\DISTRO\...` reaches WSL on the Windows computer opening that path;
it cannot access WSL on a different SSH host.

When the AI/companion run on remote WSL and Figma runs on the user's Windows PC:

1. Install the bridge for the AI client inside remote WSL as usual.
2. The SSH-side installer automatically creates `desktopBundle`, a self-contained
   Windows ZIP with the matching plugin, Connect.cmd and SSH helper. Tell the user
   to download/extract it on the Figma PC. Alternatively use the Windows bundle
   generated from the same source version or GitLab pipeline artifacts. It contains no Node runtime or credentials.
   Use that Windows copy's `plugin/manifest.json`, not a fabricated remote UNC path.
   Existing matching imported plugins do not need to be imported again.
3. On the Windows PC, double-click **Connect.cmd** and enter the existing SSH
   alias or user@host normally used for that remote machine. The host is remembered.
   Agents may instead run the helper using an explicitly supplied SSH alias:

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\connect-ssh.ps1 -RemoteHost YOUR_SSH_ALIAS
   ```

   It discovers the installed remote companion's actual port over authenticated
   SSH, then forwards an available Windows IPv4 loopback port in 4318–4327 with
   keepalives. The two ports can differ. Discovery and readiness share a 20-second
   deadline. It uses existing SSH keys/agent authentication and never terminates
   a local companion or unrelated service. SSH server forwarding must be allowed.
   Use `-RemoteInstallation /absolute/custom/install` for a nondefault remote
   installation. Optional `-RemotePort 4320` asserts the discovered remote port;
   omit it for automatic discovery. These values belong to the user's command,
   not committed source. Host-key prompts or missing key authentication must be
   resolved through the user's normal SSH setup before rerunning the helper.
4. Run the Windows Figma plugin and pair with the remote companion using the
   normal localhost browser approval. Do not copy pairing keys. An old local
   pairing may need to be replaced once when switching to the remote companion.
5. Keep the tunnel and plugin running during the session. Rerunning the helper
   for the same active host is safe. After Windows restart, rerun the helper.
   To stop just that tunnel, use `connect-ssh.ps1 -Stop`.

The remote companion still starts on the first AI tool call; no remote server
terminal is required. Files exported by the agent are stored on remote WSL. A
separate Windows-local companion can use another available port. If discovery
finds several companions, select the tunnel's printed port under Advanced
connection before pairing. Switching back to local operation may require local pairing
again; currently the plugin remembers one companion credential.

For WSL on the same Windows PC, normal Windows-to-WSL localhost forwarding may
work without a tunnel. Verify it rather than assuming it. This project's source
setup does not modify firewall rules, WSL networking settings, or global SSH config.

Agent stopping condition: installing on the SSH host alone is not proof of a
desktop connection. Return connectionMode/desktopBundle and the desktop steps;
verify connected:true only after the user completes the Windows plugin/tunnel
pairing. Do not ask them to import a Linux path or fabricate a local WSL UNC path.
For upgrades, finish any canvas write, verify the installed companion's exact
process identity, stop only that idle companion, then rerun bootstrap from a fresh
checkout. Preserve edited managed files; do not force/reset to make setup pass.

## Client differences

| Client | Setup result | Invocation |
| --- | --- | --- |
| Claude Code (local) | Personal skill in `~/.claude/skills/figma-local`; user MCP in `~/.claude.json` | `/figma-local <request>` |
| Codex (local) | Personal skill in `~/.codex/skills/figma-local`; MCP in config.toml | `Use $figma-local to <request>` |
| Claude Desktop chat | Local stdio MCP in its desktop config | Ask it to use `figma-local` tools |
| Remote/cloud chat | Cannot reach this computer's loopback server | Use a local client for setup and design edits |

Claude Desktop chat does not load Claude Code's filesystem skills. Do not pretend
that writing `~/.claude/skills` installs a skill in every Claude product.

Official references: [Claude skills](https://code.claude.com/docs/en/skills),
[Claude MCP](https://code.claude.com/docs/en/mcp),
[Node archive/checksums](https://nodejs.org/dist/v24.19.0/).

## Reruns, updates, and local edits

Rerunning the same setup is idempotent. Existing unrelated client settings and
extra files stay intact. An installation receipt tracks only installer-managed
files. If someone has edited a managed file or skill, setup refuses to overwrite
it and names the conflict before writing anything. Merge or preserve those edits;
there is deliberately no force/reset option.

Before updating a running installation, finish any canvas mutation, close its
plugin, and stop its companion. Updates refuse to replace files under a running
installed companion. Identify the process from that installation's state and
verify its executable/script before stopping it; never kill a generic Node process
or whatever occupies port 4318. Pairing data stays in the permanent `state` folder.
New source releases do not copy or replace it. Reload the plugin once after an update.

The companion selects an available port from 4318–4327 by binding its actual
listener. The plugin discovers compatible companions and proves possession of
the saved key before sending it. Expired pairing requires explicit re-pairing;
ambiguous discovery requires choosing a port. Unrelated listeners stay untouched.
Protocol 2 changes require upgrading both the companion and Windows bundle;
older running companions produce an upgrade diagnostic rather than receiving keys.
An existing unrelated `figma-local` MCP registration also requires review instead
of being overwritten. Backups can contain private client settings: keep them local.

`-DryRun` / `--dry-run` prints the planned changes without changing installation
or client settings. The bootstrap may download its verified runtime cache first.
`-NoStart` / `--no-start` installs without starting the companion. `-InstallDir` /
`--install-dir` chooses a permanent install folder outside the checkout.

## Connection checks

Run the diagnostic from the installed bridge directory printed by setup.
It checks the recorded client registrations, starts or discovers the local
companion, and reports whether a Figma file and page are connected.

| System | Command |
| --- | --- |
| Windows (PowerShell) | `& .\runtime\node.exe .\doctor.mjs` |
| macOS, Linux, or WSL | `./runtime/node ./doctor.mjs` |

Add `--share` to either command for a report that omits local paths, Figma
file and page details, and raw error messages. A disconnected plugin is
expected before pairing. Verify that the AI client itself can see the tools
by asking it to run `figma_status` after reloading it.

## Validation scope

GitHub Actions checks the clean source package on Windows, macOS, and Linux
and parses the platform bootstrap scripts. These checks do not exercise the
live Figma editor. Community publication, signed installers, and Figma
acceptance on each platform are separate release steps.

GitLab's `.gitlab-ci.yml` runs syntax and full regression checks, then builds
source and Windows desktop artifacts and reruns tests from packaged source.
The equivalent local check is `node verify-package.mjs`. It requires a fresh
output directory; pass another path as its first argument for a repeated run.
