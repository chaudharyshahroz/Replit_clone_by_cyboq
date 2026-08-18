# Admin panel

Lives on its own host. `ADMIN_HOST=admin.reklu.app` means:

- `admin.reklu.app` serves **only** `/admin` — its root redirects there, and a
  product path bounces to the main site.
- `reklu.app/admin` returns a 404 indistinguishable from any other missing
  page. A redirect would confirm an admin panel exists.

That is about blast radius: an XSS in the product has no admin route to reach on
its own origin. It costs one middleware instead of a second container to build,
deploy and patch.

Routing is **not** authorisation. `requireSuperAdmin` runs in the admin layout
*and* on every page — a Host header is client-supplied and a proxy can be
misconfigured, so it is never the only thing in the way.

## Setup

1. DNS: an A record for `admin` pointing at the same VPS as `reklu.app`.
2. Dokploy → Domains → Add Domain: host `admin.reklu.app`, service `web`,
   port `3000`, HTTPS with Let's Encrypt.
3. Environment:

```
ADMIN_HOST=admin.reklu.app
SESSION_COOKIE_DOMAIN=.reklu.app
```

`SESSION_COOKIE_DOMAIN` is not optional here. A cookie set for `reklu.app` is
host-only and never reaches a subdomain, so an administrator would land on the
admin host signed out with no way to fix it. Startup refuses the combination
rather than letting you discover it.

4. Promote yourself. There is no code path that grants admin — deliberately, because
   a UI that can grant admin is a UI that can be tricked into granting it:

```sql
UPDATE users SET is_super_admin = true WHERE email_normalized = 'you@example.com';
```

## Sections

| Section | What it controls |
| ------- | ---------------- |
| Overview | Signups, messages and active users over 30 days; queue health |
| Users | Search, suspend, reinstate, grant or revoke admin, read conversations |
| Billing | Plan visibility, subscriber counts, provider spend by model |
| AI | Enable or disable providers and individual models |
| System | Capabilities, deployment settings, feature flags, audit trail |

## Reading private content

Everything except one action reads operational data — counts, plans, spend,
account status. Reading a user's conversations is separated from all of it and
**requires a written reason**, recorded with your identity, IP and timestamp
before anything is shown.

That is not friction for its own sake. Support work genuinely needs this
sometimes; it should never happen without a record of who looked and why. Six
months later, "an admin read this account" is far less useful than "investigating
ticket 412".

The audit row is written **before** the read, so an attempt that fails is still
recorded.

## Two guards worth knowing

- **You cannot suspend your own account.** It would lock you out of the platform
  you administer.
- **You cannot remove the last administrator.** A platform with no admin cannot
  be administered, and the fix would be a manual SQL statement at the worst
  possible moment.
