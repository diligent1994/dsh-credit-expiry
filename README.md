# dsh-credit-expiry

A standalone **client-only** plugin for DeepSeek Harness (dsh). It adds a
sid ‑bar panel **「积分到期」** that shows which channel credits expire over the
next **7 days**, grouped **by day** and **per channel**, with a grand total and a
manual refresh button.

It reads the existing dsh-xs‑`dsh-xdpool` HTTP endpoints
(`/plugins/dsh-xdpool/status` and `/api/channel-pack`). It **does not modify**
`dsh-xdpool`, so it survives `dsh-xdpool` upgrades.

## Requirements

- A running dsh **web** profile (the plugin is browser-side only, `platform: "web"`).
- **dsh-xdpool** (≥ 2.6.1) installed and enabled in that profile — it is the data
  provider. If xdpool is not present, the panel shows an error/empty state.

## Install

From the plugin repository (GitHub path) or npm:

```bash
# GitHub source (branch HEAD tarball)
dsh plugin add github:<owner>/dsh-credit-expiry

# or, once published to npm
dsh plugin add dsh-credit-expiry
```

Then restart the web profile and open the **「积分到期」** panel from the sidebar.

## How it works

- Fetches pool packages with `expiresAtMs` from `GET /plugins/dsh-xdpool/status?region=cn|global`.
- Fetches per‑provider credit packages (`remaining` + `deductionEndTime` /
  `expiredTime`) via `POST /api/channel-pack` `credits.balances`.
- Keeps only packages with `now < expiry <= now + 7d`, buckets them by local day,
  and sums per channel (`unit` may be `credits`/`tokens`/`dollars`).

> Note: some providers (e.g. qoder resource packs) do not expose an expiry date
> upstream — such packages are honestly not shown.

## License

MIT — see [LICENSE](LICENSE).