# Security

Report vulnerabilities through [GitHub private vulnerability reporting](../../security/advisories/new)
when it is enabled. If it is unavailable, contact the maintainer privately.
Keep credentials, pairing links, internal network details, and private Figma
files out of public issues and pull requests.

## Trust model

- The companion binds to loopback and checks the request host. Reading or
  editing a file requires authentication with a randomly generated pairing key.
- Only approve a pairing you initiated from the Figma plugin. Pairing authorizes
  a local client to read and edit the active file while the plugin is running.
  Use the bridge with trusted clients and on a trusted computer. Local processes
  that can read your files may also be able to read the pairing state.
- Installation state, logs, and exported design assets are local data. Keep
  them out of source commits and issue attachments. Use the
  [diagnostic share mode](INSTALL.md#connection-checks) for support.
- The bridge has no hosted relay. What your AI client sends to its provider is
  governed by the client and provider settings.
