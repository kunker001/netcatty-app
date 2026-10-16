# Hello Netcatty

This package is the runnable internal example for the plugin API. With
`NETCATTY_PLUGIN_DEV=1`, package and install it to exercise native settings,
command-palette contributions, lazy command and Provider activation,
localization, terminal completion/decoration Providers, and the runtime SDK.

From the repository root:

```bash
npm run build:plugin-packages
npm exec -- netcatty-plugin validate examples/plugins/hello-netcatty
npm exec -- netcatty-plugin compatibility examples/plugins/hello-netcatty --netcatty 0.0.0
npm exec -- netcatty-plugin pack examples/plugins/hello-netcatty --out /tmp/hello-netcatty.ncpkg
```

After installation, change **Greeting** under **Settings → Plugins**, then run
**Examples: Say Hello** from the command palette. The setting is read through
the host settings broker and the command handler is registered inside the
sandboxed plugin runtime. Type `netc` at a shell prompt to exercise the bounded
completion Provider, and print `Hello from Netcatty` to exercise the declarative
decoration Provider. Neither Provider receives raw xterm objects or sensitive
terminal input/output streams.
