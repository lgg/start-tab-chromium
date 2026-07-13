# Complete Roadmap Implementation

Date: 2026-07-13
Branch: `codex/complete-roadmap-instance-layout-themes-20260713`
Base: `master`

## Initial architecture findings

- Layout records already expose stable-looking `id` values, but block configuration is still stored in global singleton sections such as `dateTime`, `weather`, `search`, `links`, `googleCalendar`, and `timers`.
- `LayoutBlock.config` is an unvalidated `Record<string, unknown>` and is not the source of truth for rendering.
- Timer, stopwatch, and Pomodoro runtime state is keyed by block type rather than instance ID.
- Local tasks use one shared array; notes only partly key data by block ID; link pagination uses one shared `links` key.
- Options expose global block settings and raw JSON instead of a shared per-instance settings model.
- Background presets exist, but text/card/accent/typography tokens are not represented as versioned theme records.
- Backup and browser sync are versioned and chunked, but require a schema upgrade for block instances, themes, tombstones, and atomic restore.

## Required implementation checklist

- [ ] Typed discriminated-union block instance schema
- [ ] Repeatable and singleton registry
- [ ] Sequential idempotent migration from legacy settings/runtime data
- [ ] Independent runtime state for clocks, notes, tasks, and link pages
- [ ] Instance-aware new tab rendering
- [ ] Full block palette and instance CRUD
- [ ] Free/grid editing and contained/full layout zones
- [ ] Shared per-instance settings editor for new tab and options
- [ ] Versioned theme system and custom theme import/export
- [ ] Centralized validation and localized errors
- [ ] Backup v4, browser sync, and Drive restore migration coverage
- [ ] EN/RU localization parity
- [ ] Static and domain validation tests
- [ ] Full and blocker-only builds
- [ ] Documentation and reproducible manual QA
- [ ] First audit, fixes, rerun validation
- [ ] Second independent audit, fixes, rerun validation
