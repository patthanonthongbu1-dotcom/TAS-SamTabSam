# DESIGN.md — Modern App Design Guide (for AI coding assistants)

How to use: put this file in the project root and tell the AI "follow DESIGN.md for all UI".
Built from Apple's Liquid Glass / HIG guidance, Google's Material 3 Expressive, and 2026 mobile UI trends.
Default look for Clouds' apps: **calm, white-ish, soft blue, glassy, lots of smooth motion.**

---

## 1. Core principles (apply to every screen)

1. **Content leads, controls float.** Content is the star. Nav bars, tab bars, buttons and sheets float above it as translucent glass. Never cover content with heavy opaque chrome.
2. **Glass is for controls only.** Use the glass effect on navigation, toolbars, floating buttons and sheets. Do NOT put glass on every card or on body text areas. Overusing it hurts readability and looks messy.
3. **Hierarchy through depth.** Background -> content -> floating controls. Use blur, soft shadow and slight transparency to separate the layers, not hard borders.
4. **Concentric shapes.** Rounded things nest cleanly: inner radius = outer radius - padding. A button inside a card should follow the card's curve.
5. **Round and friendly.** Large corner radii everywhere. Prefer pill buttons, soft cards, circular icon buttons.
6. **Motion is part of the design.** Things should shrink, expand, morph and spring. Every tap gets feedback. Nothing just "pops" into existence.
7. **Accessibility is mandatory, not optional.** Touch targets, contrast and reduced motion are required inputs, not a final checklist.

---

## 2. Design tokens (copy into `:root`)

```css
:root {
  /* Color: whiter, calm blue */
  --bg: #f6f9ff;
  --bg-grad: linear-gradient(160deg, #f8fbff 0%, #e8f0ff 55%, #dbe8ff 100%);
  --surface: rgba(255, 255, 255, 0.72);
  --surface-strong: rgba(255, 255, 255, 0.9);
  --text: #0f1b33;
  --text-muted: #5b6b8a;
  --primary: #3b82f6;
  --primary-deep: #1d4ed8;
  --accent: #7c9cff;        /* secondary tint */
  --accent-2: #ff8a5c;      /* third accent for important/stop/alert moments */
  --success: #22c55e;
  --danger: #ef4444;
  --border-glass: rgba(255, 255, 255, 0.65);

  /* Radii (keep concentric) */
  --r-sm: 12px;
  --r-md: 20px;
  --r-lg: 28px;
  --r-pill: 999px;

  /* Spacing (8pt grid) */
  --s1: 4px; --s2: 8px; --s3: 12px; --s4: 16px; --s5: 24px; --s6: 32px; --s7: 48px;

  /* Motion */
  --ease-out: cubic-bezier(0.22, 1, 0.36, 1);
  --spring: linear(0, 0.35 12%, 0.8 28%, 1.06 44%, 0.98 60%, 1.01 78%, 1);
  --t-fast: 150ms; --t-med: 280ms; --t-slow: 480ms;
}

@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0a1224;
    --bg-grad: linear-gradient(160deg, #0b1530 0%, #0e1d45 60%, #132a63 100%);
    --surface: rgba(20, 32, 64, 0.6);
    --surface-strong: rgba(24, 38, 76, 0.88);
    --text: #eaf1ff;
    --text-muted: #9fb0d4;
    --border-glass: rgba(255, 255, 255, 0.14);
  }
}
```

Rules:
- Always use tokens, never hard-coded colors in components.
- Support light AND dark from day one.
- Use a gradient background behind glass; glass on a flat color looks dead.

---

## 3. Liquid-glass component (web approximation)

```css
.glass {
  background: var(--surface);
  -webkit-backdrop-filter: blur(22px) saturate(1.6);
  backdrop-filter: blur(22px) saturate(1.6);
  border: 1px solid var(--border-glass);
  border-radius: var(--r-lg);
  box-shadow:
    0 8px 30px rgba(20, 40, 90, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.7);   /* top highlight = "specular" edge */
}
.glass:active { transform: scale(0.97); transition: transform var(--t-fast) var(--ease-out); }

/* fallback when blur isn't supported */
@supports not (backdrop-filter: blur(1px)) {
  .glass { background: var(--surface-strong); }
}
```

Where to use glass: bottom tab bar, top bar, floating action button, bottom sheets, the main hero card/timer on the home screen.
Where NOT to: long text, list rows, every card, anything stacked on top of other glass (glass on glass looks muddy).

---

## 4. Layout and navigation

- **Mobile first**, then adapt up to tablet/desktop. The interface must resize cleanly (phone, iPad, PC window).
- Respect safe areas: `padding-bottom: env(safe-area-inset-bottom)`, same for top.
- **Bottom tab bar** (3-5 items) as a floating glass pill, with the active tab highlighted. Primary actions live in thumb reach.
- Keep one clear primary action per screen. Everything else is secondary.
- Use generous whitespace. Group with spacing and soft surfaces, not divider lines.
- Prefer **larger text** and clear hierarchy: one big headline, calm supporting text.
- Sheets and menus should *morph out of* the button that opened them (scale + position from the trigger), not appear from nowhere.

---

## 5. Typography

- Use one variable font family (Inter, "Plus Jakarta Sans", or the system UI font). Thai-friendly pairing: **"Noto Sans Thai"** or **"Prompt"** as the fallback.
- Scale (mobile): Display 34-40 / Title 24-28 / Body 16 / Caption 13.
- Body text never below 16px on mobile. Weight contrast (400 vs 600/700) does the hierarchy work.
- Use tabular numbers for timers/stats: `font-variant-numeric: tabular-nums;`
- Optional expressive touch: animate font weight on press/active using a variable font.

---

## 6. Color usage

- One primary color + one soft accent + **one extra accent for alerts/stop/important moments** (the "third accent" idea from Material 3 Expressive).
- Use tonal steps (lighter/darker versions of the same hue) for surfaces, not random new colors.
- Gradients: subtle, same-hue, 2-3 stops. Never rainbow.
- Contrast: text on surfaces must meet WCAG AA (4.5:1 body, 3:1 large). Check text over glass, since it is the usual failure.
- Never use color alone to carry meaning. Pair with an icon or label.

---

## 7. Motion and micro-interactions

Use motion to explain *where things came from and went*, and to make taps feel alive.

| Moment | Behavior |
|---|---|
| Tap button | scale to ~0.96, spring back (150-250ms) |
| Toggle/slider | knob grows and turns glassy while held |
| Open sheet/menu | morph/scale out of the trigger, 280-400ms, spring easing |
| Page change | shared-element or slide with slight parallax; fade content in with a small stagger |
| Lists | items stagger in (30-50ms apart); tapping a card expands it into its detail view |
| Carousels | snap scrolling with peek of the next card (`scroll-snap-type: x mandatory`) |
| Loading | skeleton shimmer or a morphing-shape loader, not a plain spinner |
| Success | small celebratory pop (check draws in, subtle confetti/pulse) |

Rules:
- Durations: 150ms (feedback), 280ms (transitions), 480ms (big layout moves). Nothing over 600ms.
- Prefer spring/ease-out curves over linear.
- Animate only `transform` and `opacity` where possible (smooth on phones).
- **Must respect reduced motion:**

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; }
}
```

- Add haptics on supported devices for key actions (`navigator.vibrate(10)` on Android/web, native haptics in real apps).

---

## 8. Shape language (Material 3 Expressive influence)

- Mix a few container shapes (pill, squircle-ish rounded rect, circle) to create personality, but keep them consistent per component type.
- Buttons can **morph shape on state change** (pill -> circle while loading, rounded rect -> pill when selected).
- Selected states can use a bigger/rounder shape plus a filled tonal color.
- Group related buttons into a connected pill group instead of separate loose buttons.

---

## 9. Components checklist

- **Buttons:** min height 48px, pill radius, clear pressed state, disabled state, loading state.
- **Cards:** `--r-lg`, soft shadow, 16-24px padding. Tap = scale feedback.
- **Inputs:** 48px+ height, visible focus ring, inline validation text (not alert popups).
- **Lists:** 56-64px rows, avatar/icon left, chevron right, no heavy dividers.
- **Toasts/snackbars:** floating glass pill near the bottom, auto-dismiss, never blocking taps.
- **Empty states:** friendly illustration/mascot + one clear action. (Great spot for the OC mascot.)
- **Icons:** one consistent set (Lucide or SF Symbols style), 24px, consistent stroke.

---

## 10. Accessibility (non-negotiable)

- Touch targets **at least 44x44 pt** (prefer 48px). Small targets cause lots of mis-taps.
- Contrast AA minimum, especially over glass and gradients.
- Visible focus states for keyboard use.
- Support dark mode, large text/zoom, and reduced motion.
- Every icon-only button needs an `aria-label`.
- Don't rely on hover; everything must work with touch.

---

## 11. 2026 trends worth using (in moderation)

- **Micro-interactions:** small delightful feedback on taps, toggles and completions.
- **Personalization:** greetings, time-of-day tint, remembered preferences, a mascot with emotions.
- **Adaptive dark mode and customizable themes.**
- **Modern skeuomorphism:** soft depth, light and shadow (glass, subtle 3D) with minimal clutter.
- **Minimal, content-focused screens** with larger type.
- **Predictive/AI helpers:** suggested next action, smart defaults. Keep them optional and unobtrusive.
- **Session receipts / monthly wrap** screens: playful summaries that make progress feel good.

---

## 12. Don'ts

- Don't stack glass on glass or put it behind paragraphs of text.
- Don't use more than 1 primary + 1 accent + 1 alert color.
- Don't use pure black (#000) or pure white text on pure white/black backgrounds. Use the tokens.
- Don't animate everything at once. One focal animation per moment.
- Don't ship text smaller than 13px, or tap targets smaller than 44px.
- Don't copy another app's exact look or assets. Take the principles, make it yours.

---

## 13. Prompt to give the AI

> Follow DESIGN.md strictly. Build mobile-first with the CSS tokens, glass only on controls and the hero element, spring-based micro-interactions, concentric rounded shapes, light + dark themes, 44px+ tap targets, and `prefers-reduced-motion` support. Before finishing, list which DESIGN.md rules you applied and anything you skipped.

---

## Sources
- Apple, "Liquid Glass" and "Adopting Liquid Glass" (developer.apple.com/documentation/technologyoverviews)
- Apple Human Interface Guidelines, Materials
- Google, Material 3 Expressive design language (developer.android.com/design/ui/wear/guides/get-started)
- 2026 mobile UI trend roundups (Svitla, Elinext, Designveloper)