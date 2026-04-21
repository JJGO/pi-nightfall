# pi-nightfall

`pi-nightfall` manages a shared Pi theme alias named `system`.

It rewrites `~/.pi/agent/themes/system.json` from one of these source themes:

- `~/.pi/agent/themes/system-dark.json`
- `~/.pi/agent/themes/system-light.json`

The extension prefers host-side signals in this order:

1. manual override
2. macOS appearance via `dark-notify` when available
3. sunrise/sunset based on cached host geolocation

## Why this package exists

Using a stable `system` theme alias avoids having multiple Pi instances fight over Pi's global `theme` setting. Each instance can stay on the `system` theme while Pi hot-reloads the shared `system.json` file whenever this package updates it.

## Install

```bash
pi install /absolute/path/to/pi-nightfall
```

Or from the package directory:

```bash
pi install .
```

## Requirements

For the default workflow, keep these theme files in place:

- `~/.pi/agent/themes/system-dark.json`
- `~/.pi/agent/themes/system-light.json`

The package generates:

- `~/.pi/agent/themes/system.json`

Optional on macOS:

```bash
brew install cormacrelf/tap/dark-notify
```

Without `dark-notify`, the extension falls back to a coarse poll of macOS appearance.

## Commands

```text
/auto-theme status
/auto-theme refresh
/auto-theme locate
/auto-theme override dark
/auto-theme override light
/auto-theme override auto
/auto-theme enroll
```

- `status`: show the current shared state, leadership, and next transition
- `refresh`: recompute the desired mode now and rewrite `system.json` if needed
- `locate`: refresh host geolocation from `https://ipinfo.io/json`
- `override`: force dark, force light, or return to automatic mode
- `enroll`: set Pi's configured theme to `system`

## Shared files

The extension stores small coordination files under `~/.pi/agent/`:

- `auto-theme-config.json`
- `auto-theme-location.json`
- `auto-theme-override.json`
- `auto-theme-state.json`
- `auto-theme.lock`

## Notes

- The extension only manages the shared `system.json` alias. It does not rewrite your dark/light source themes.
- The extension automatically switches the current Pi session to the `system` theme when possible.
- Headless hosts use one cached location lookup and local sunrise/sunset calculation instead of repeated API calls.
