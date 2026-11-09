window.__ModuleLoader__.load({
	id: "dsh-credit-expiry",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		let react_jsx_runtime = require("react/jsx-runtime");

		// ------------------------------------------------------------------
		// dsh-credit-expiry / client
		//
		// Standalone read-only sidebar panel: shows which channel credits
		// (packages) expire within the next 7 days, grouped by local day and
		// per channel.
		//
		// Data is read from dsh-xdpool's own surface:
		//   - GET  /plugins/dsh-xdpool/status?region=cn|global  (pool lanes:
		//     buddy / workbuddy) — packages[].expiresAtMs
		//   - POST /api/channel-pack  RPC "credits.balances" {provider}
		//     (trae / qoder / qodercn / cline / ...) — packages[].deductionEndTime
		//
		// No part of dsh-xdpool is modified, so an xdpool upgrade cannot
		// clobber this panel.
		// ------------------------------------------------------------------

		const DAY_MS = 86400000;

		function fetchJson(url) {
			return fetch(url, { headers: { accept: "application/json" }, credentials: "same-origin" })
				.then((r) => (r.ok ? r.json().catch(() => void 0) : null));
		}

		// RPC envelope the pack server answers on /api/channel-pack.
		function packRpc(method, payload) {
			return fetch("/api/channel-pack", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "same-origin",
				body: JSON.stringify({
					type: "client-request",
					rpcId: "cexp-" + Date.now().toString(36),
					method: "channel-pack",
					payload: { method, payload }
				})
			})
				.then((r) => r.json().catch(() => void 0))
				.then((body) => {
					const result = body && body.result;
					if (result && result.ok === true) return result.value;
					throw new Error((result && result.error && (result.error.message || result.error.code)) || "channel-pack rpc failed");
				});
		}

		function localDayKey(ms) {
			const d = new Date(ms);
			const y = d.getFullYear();
			const m = String(d.getMonth() + 1).padStart(2, "0");
			const day = String(d.getDate()).padStart(2, "0");
			return `${y}-${m}-${day}`;
		}

		function startOfLocalDay(ms) {
			const d = new Date(ms);
			d.setHours(0, 0, 0, 0);
			return d.getTime();
		}

		// Pull every package expiring within (now, now+7d] and fold it into
		// dayKey -> channel -> unit -> amount.
		async function collect() {
			const now = Date.now();
			const todayStart = startOfLocalDay(now);
			const horizon = now + 7 * DAY_MS;

			// Channel display names from the roster.
			const rosterBody = await fetchJson("/plugins/dsh-xdpool/channels");
			const roster = rosterBody && Array.isArray(rosterBody.channels) ? rosterBody.channels : [];
			const nameOf = new Map();
			for (const c of roster) {
				if (c && typeof c.id === "string") nameOf.set(c.id, (typeof c.name === "string" && c.name !== "") ? c.name : c.id);
			}

			const dayMap = new Map();
			// dayKey -> channel -> unit -> amount
			const add = (exp, channelKey, amount, unit) => {
				if (!(amount > 0) || !Number.isFinite(amount) || !(exp > now) || exp > horizon) return;
				const dayKey = localDayKey(exp);
				let cm = dayMap.get(dayKey);
				if (!cm) { cm = new Map(); dayMap.set(dayKey, cm); }
				let file = cm.get(channelKey);
				if (!file) { file = new Map(); cm.set(channelKey, file); }
				const u = typeof unit === "string" && unit !== "" ? unit : "tokens";
				file.set(u, (file.get(u) || 0) + amount);
			};

			// 1) Pool lanes (buddy / workbuddy): /status per region.
			for (const region of ["cn", "global"]) {
				const s = await fetchJson(`/plugins/dsh-xdpool/status?region=${region}`);
				const accounts = s && Array.isArray(s.accounts) ? s.accounts : [];
				for (const acc of accounts) {
					const pkgs = acc && acc.credits && Array.isArray(acc.credits.packages) ? acc.credits.packages : [];
					for (const p of pkgs) {
						if (!p || typeof p.expiresAtMs !== "number") continue;
						add(p.expiresAtMs, (typeof acc.channel === "string" && acc.channel !== "") ? acc.channel : (acc.label || region), p.remain, "tokens");
					}
				}
			}

			// 2) Channel-pack lanes: credits.balances per provider.
			for (const ch of roster) {
				let value;
				try { value = await packRpc("credits.balances", { provider: ch.id }); } catch { continue; }
				const accounts = value && Array.isArray(value.accounts) ? value.accounts : [];
				for (const entry of accounts) {
					const balance = entry && entry.balance;
					const pkgs = balance && Array.isArray(balance.packages) ? balance.packages : [];
					for (const p of pkgs) {
						if (!p) continue;
						let exp = NaN;
						if (typeof p.deductionEndTime === "number" && Number.isFinite(p.deductionEndTime)) exp = p.deductionEndTime;
						else if (typeof p.expiredTime === "string" && p.expiredTime !== "") exp = Date.parse(p.expiredTime.replace(" ", "T"));
						if (!(exp > now) || exp > horizon) continue;
						add(exp, nameOf.get(ch.id) || ch.id, p.remaining, p.unit);
					}
				}
			}

			const rows = [];
			for (const [dayKey, cm] of dayMap) {
				const channels = [];
				let dayTotal = 0;
				for (const [channel, file] of cm) {
					const parts = [];
					let chTotal = 0;
					for (const [unit, amount] of file) { parts.push(normalizeNum(amount) + " " + unit); chTotal += amount; }
					channels.push({ channel, parts, total: chTotal });
					dayTotal += chTotal;
				}
				channels.sort((a, b) => b.total - a.total);
				rows.push({ dayKey, channels, total: dayTotal });
			}
			rows.sort((a, b) => (a.dayKey < b.dayKey ? -1 : a.dayKey > b.dayKey ? 1 : 0));

			return { rows, todayStart, grand: rows.reduce((s, r) => s + r.total, 0) };
		}

		function normalizeNum(n) {
			return Number.isInteger(n) ? String(n) : (Math.round(n * 100) / 100).toString();
		}

		function dayLabel(dayKey, todayStart) {
			const [y, m, d] = dayKey.split("-").map(Number);
			const date = new Date(y, m - 1, d);
			const diff = Math.round((date.getTime() - todayStart) / DAY_MS);
			if (diff === 0) return "今天";
			if (diff === 1) return "明天";
			return new Intl.DateTimeFormat("zh-CN", { weekday: "short", month: "numeric", day: "numeric" }).format(date);
		}

		// ------------------------------ components ------------------------------

		function PanelIcon({ size }) {
			const edge = typeof size === "number" && size > 0 ? size : 16;
			return react_jsx_runtime.jsx("svg", {
				xmlns: "http://www.w3.org/2000/svg",
				viewBox: "0 0 24 24",
				width: edge,
				height: edge,
				"aria-hidden": "true",
				focusable: "false",
				children: react_jsx_runtime.jsx("path", {
					fill: "currentColor",
					d: "M7 2h10a2 2 0 0 1 2 2v2h2v2h-2v2h2v2h-2v2h2v2h-2v2h-2v2H7a2 2 0 0 1-2-2v-2H3v-2h2v-2H3v-2h2V8H3V6h2V4a2 2 0 0 1 2-2zm0 2v2h2V4H7zm4 0v2h2V4h-2zm4 0v2h2V4h-2zM7 10v4h2v-4H7zm4 0v4h2v-4h-2zm4 0v4h2v-4h-2z"
				})
			});
		}

		const PAGE_CSS = [
			".dsm-cexp-page{height:100%;min-height:0;overflow:auto;padding:16px;font-size:13px;line-height:1.6;color:var(--dsh-fg,#1f2328)}",
			".dsm-cexp-card{max-width:640px;margin:0 auto}",
			".dsm-cexp-title{font-size:15px;font-weight:600;margin:0 0 4px}",
			".dsm-cexp-sub{opacity:.65;font-size:12px;margin:0 0 12px}",
			".dsm-cexp-day{margin:12px 0 0;padding:10px 12px;border:1px solid var(--dsh-border,transparent);border-radius:8px;background:var(--dsh-card-bg,transparent)}",
			".dsm-cexp-day h4{margin:0 0 8px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center}",
			".dsm-cexp-day h4 span{opacity:.6;font-weight:400;font-size:12px}",
			".dsm-cexp-row{display:flex;justify-content:space-between;align-items:center;padding:3px 0;border-bottom:1px dashed var(--dsh-border,transparent)}",
			".dsm-cexp-row:last-child{border-bottom:none}",
			".dsm-cexp-row .ch{font-weight:500}",
			".dsm-cexp-row .amt{opacity:.9;white-space:pre}",
			".dsm-cexp-empty{opacity:.7;padding:16px;text-align:center}",
			".dsm-cexp-loading,.dsm-cexp-err{padding:16px;text-align:center;opacity:.75}",
			".dsm-cexp-err{color:var(--dsh-danger,#c0392b)}",
			".dsm-cexp-bar{display:flex;justify-content:space-between;align-items:center;margin-top:12px}",
			".dsm-cexp-refresh{border:1px solid var(--dsh-border,transparent);background:transparent;border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;color:inherit}",
			".dsm-cexp-refresh:disabled{opacity:.5;cursor:default}",
			".dsm-cexp-grand{font-size:13px;font-weight:600}"
		].join("\n");

		function CreditExpiryPage() {
			const [data, setData] = react.useState(void 0);
			const [loading, setLoading] = react.useState(true);
			const [error, setError] = react.useState(void 0);
			const [epoch, setEpoch] = react.useState(0);

			react.useEffect(() => {
				let alive = true;
				setLoading(true);
				setError(void 0);
				collect()
					.then((r) => { if (alive) setData(r); })
					.catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)); })
					.finally(() => { if (alive) setLoading(false); });
				return () => { alive = false; };
			}, [epoch]);

			let body;
			if (loading) {
				body = react_jsx_runtime.jsx("div", { className: "dsm-cexp-loading", children: "加载中…" });
			} else if (error) {
				body = react_jsx_runtime.jsx("div", { className: "dsm-cexp-err", children: "读取失败：" + error });
			} else if (!data || data.rows.length === 0) {
				body = react_jsx_runtime.jsx("div", { className: "dsm-cexp-empty", children: "未来 7 天没有到期的渠道积分。" });
			} else {
				body = react_jsx_runtime.jsxs("div", {
					className: "dsm-cexp-card",
					children: [
						react_jsx_runtime.jsx("h2", { className: "dsm-cexp-title", children: "未来 7 天积分到期" }),
						react_jsx_runtime.jsx("p", { className: "dsm-cexp-sub", children: "按天分组 · 每渠道到期积分总数（读自 dsh-xdpool 账户池）" }),
						data.rows.map((row) =>
							react_jsx_runtime.jsxs("div", {
								className: "dsm-cexp-day",
								children: [
									react_jsx_runtime.jsxs("h4", {
										children: [dayLabel(row.dayKey, data.todayStart),
											react_jsx_runtime.jsx("span", { children: normalizeNum(row.total) + " 积分" })]
									}),
									row.channels.map((c) =>
										react_jsx_runtime.jsxs("div", {
											className: "dsm-cexp-row",
											children: [react_jsx_runtime.jsx("span", { className: "ch", children: c.channel }),
												react_jsx_runtime.jsx("span", { className: "amt", children: c.parts.join(" · ") })]
										}))
								]
							}))
					]
				});
			}

			return react_jsx_runtime.jsxs("div", {
				className: "dsm-cexp-page",
				children: [
					react_jsx_runtime.jsx("style", { children: PAGE_CSS }),
					body,
					react_jsx_runtime.jsxs("div", {
						className: "dsm-cexp-bar",
						children: [
							react_jsx_runtime.jsx("span", { className: "dsm-cexp-grand", children: data ? "7天合计 " + normalizeNum(data.grand) + " 积分" : "" }),
							react_jsx_runtime.jsx("button", {
								className: "dsm-cexp-refresh",
								disabled: loading,
								onClick: () => setEpoch((n) => n + 1),
								children: "刷新"
							})
						]
					})
				]
			});
		}

		const name = "dsh-credit-expiry-client";
		const inject = ["slots"];
		const NAV_LABEL = "积分到期";

		function apply(ctx) {
			let disposeRow;
			const registerRow = () => {
				if (disposeRow) return;
				disposeRow = ctx.slots.register({
					name: "sidebar.panellist",
					id: "credit-expiry",
					order: 21,
					label: () => NAV_LABEL
				}, PanelIcon);
			};
			ctx.slots.inject("sidebar.panellist", () => {
				registerRow();
				return () => { if (disposeRow) { const d = disposeRow; disposeRow = void 0; try { d(); } catch {} } };
			});
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: "credit-expiry",
				inject: () => ({})
			}, CreditExpiryPage));
		}

		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});