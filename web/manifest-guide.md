# manifest.json — customization guide

`manifest.json` is what makes the site installable as an app ("Add to Home
Screen"). The phone reads it once at install time to decide the app's name,
icon, colors and how it opens. It's plain JSON — **no comments allowed**, no
trailing commas, and every string in double quotes. This guide explains every
field we use so you can tweak it safely.

> After editing: commit + push (Netlify redeploys). Installed apps pick up
> changes slowly — Android re-checks the manifest about once a day, or you can
> uninstall/reinstall the app to see changes immediately.

## Field-by-field

| Field | Current value | What it does / how to customize |
|---|---|---|
| `id` | `"tas-calendar"` | Stable identity of the installed app. **Never change this** once people have installed — changing it makes phones treat the next install as a *different* app. It exists so you can freely change `start_url` later. |
| `lang` | `"th"` | Primary language of the app's text (BCP-47 code). `"th"` for Thai, `"en"` for English. Cosmetic — used by app stores/OS. |
| `dir` | `"ltr"` | Text direction: `ltr` or `rtl`. Thai and English are both `ltr` — leave it. |
| `name` | `"TAS Calendar — 3/3 Academic System"` | Full app name — shown on the install prompt and splash screen. Up to ~45 chars is safe. |
| `short_name` | `"TAS Calendar"` | Name under the home-screen icon. Keep it **≤ 12 characters** or Android/iOS will ellipsize it. |
| `description` | `"Class task calendar…"` | One-liner shown in install dialogs on some browsers. Freely editable. |
| `start_url` | `"calendar.html?src=pwa"` | The page that opens when the app icon is tapped. The `?src=pwa` part does nothing functional — it just lets analytics/DevTools tell app launches apart from browser visits. Point it at another page if you ever want the app to open somewhere else. |
| `scope` | `"."` | Which URLs count as "inside the app". `"."` = the whole site, so calendar → announce navigation stays in the app window instead of popping open a browser. Leave as is. |
| `display` | `"standalone"` | How the app window looks. `standalone` = no browser UI (looks like a native app). Other options: `fullscreen` (also hides the status bar — not recommended), `minimal-ui` (thin browser bar), `browser` (a normal tab, i.e. no app feel). |
| `orientation` | `"any"` | Locks rotation if you want. `"portrait"` forces upright, `"landscape"` sideways, `"any"` follows the phone. The calendar works in both, so `any`. |
| `background_color` | `"#0b1c3d"` | Splash-screen color while the app loads. Should match the page's own background (`--navy-dark` in calendar.html) so the launch looks seamless. If you retheme the site, change both together. |
| `theme_color` | `"#0b1c3d"` | Tints the Android status bar / title bar around the app. Also keep in sync with `<meta name="theme-color">` in calendar.html — the meta tag wins while the page is open, the manifest value is used at launch. |
| `icons` | 2 entries | See below. |

## Icons

```json
{ "src": "TASLogo.png", "sizes": "500x500", "type": "image/png", "purpose": "any" }
```

- `src` — path relative to manifest.json (both live in `web/`).
- `sizes` — must state the PNG's real pixel size. If you swap the file, update this.
- `purpose: "any"` — the normal icon, used as-is.
- `purpose: "maskable"` — Android crops this one into a circle/squircle.
  **Rule of thumb: keep all important artwork inside the middle 80%** of the
  image (the outer 10% on each side may be cut off). Preview how it crops at
  <https://maskable.app>. Right now we reuse the 500×500 logo — if the logo
  ever looks clipped on Android, export a version with extra padding and point
  the maskable entry at it.
- Want crisper icons? Add more sizes (192×192 and 512×512 are the two Android
  actually asks for):

```json
"icons": [
  { "src": "icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
  { "src": "icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
  { "src": "icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
]
```

## Nice-to-have fields you could add later

- **`shortcuts`** — long-press menu on the app icon (e.g. jump straight to
  Archive). Needs the target URLs to actually do something, so we'd add a
  query-param handler in calendar.html first:

```json
"shortcuts": [
  { "name": "Archive", "url": "calendar.html?view=archive", "icons": [{ "src": "TASLogo.png", "sizes": "500x500" }] }
]
```

- **`screenshots`** — pictures shown in Chrome's richer install dialog.
  Purely cosmetic, needs real screenshot files committed to `web/`.

## Where it's wired up

- `calendar.html` has `<link rel="manifest" href="manifest.json">` plus
  apple-touch-icon/meta tags (iOS ignores most of the manifest and uses those
  tags instead — if you change the icon, also update `apple-touch-icon`).
- `web/sw.js` (service worker) is what makes Android consider the site
  installable and handles notification clicks. It does **not** cache anything,
  so deploys always show fresh content.

## Validate after editing

1. JSON check: paste into <https://jsonlint.com> or run `node -e "JSON.parse(require('fs').readFileSync('web/manifest.json'))"`.
2. Real check: open the deployed site in Chrome → DevTools → **Application → Manifest** — it shows every parsed field, the icons, and warnings (e.g. maskable safe-zone).
