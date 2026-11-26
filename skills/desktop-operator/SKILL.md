---
name: desktop-operator
description: High-speed Windows desktop UI Automation (UIA) and visual/DirectX interaction playbook via Antigravity Operator without stealing focus unnecessarily.
---

# Desktop Operator (`operator_desktop_*`)

> **Prerequisite:** These tools (`operator_desktop_*`) are **optional federated tools** provided by the separate `antigravity-operator` plugin (`DesktopDriver.exe`). Enable and configure the bridge in `/admin` before using them.

## 1. Non-Intrusive First (UI Automation)
- Start with read-only inspection that does not steal focus or move the physical cursor:
  1. `operator_desktop_list_windows` to locate the target `hwnd`.
  2. `operator_desktop_ui_tree` to inspect native Windows controls, buttons, and inputs.
  3. `operator_desktop_ui_action` (`click`, `invoke`, `toggle`, `select`, `set_value`) keeping `allow_mouse_fallback: false` (default).
- Use `operator_desktop_screenshot` with `mode: "window"` for targeted non-intrusive visual inspection when needed.

## 2. Physical / Visual / 3D Input (`operator_desktop_act`)
- Reserve `operator_desktop_act`, `operator_desktop_focus_window`, and `allow_mouse_fallback: true` for visual canvases, custom-drawn UI, DirectX/3D apps, or when the user explicitly requests physical interaction.
- Batch actions inside `operator_desktop_act` ("Act & See") to receive an updated inline frame in one round-trip.
- **Coordinate Spaces:** Default `coord_space` is `"image"` (matching the pixel dimensions of the latest screenshot/frame). Pass `coord_space: "screen"` only when using raw coordinates from `list_windows` or `ui_tree`.
- **Kill-Switch Respect:** If any action returns `status: "aborted"`, stop immediately and report to the user. Do not override the abort state without asking.
