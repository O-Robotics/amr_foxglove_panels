# AMR Sweeper Joystick Panel

Foxglove Studio panel for viewing, generating, and publishing ROS 2 `sensor_msgs/msg/Joy` messages.

## What it does

- Subscribe to an existing `Joy` topic and display the current state.
- Read a browser gamepad and publish mapped `Joy` output.
- Generate `Joy` output from keyboard input.
- Provide an interactive on-screen controller for touch or pointer input.

## Data model

- Incoming topic type: `sensor_msgs/msg/Joy`
- Published topic type: `sensor_msgs/msg/Joy`

## Modes

- `sub-joy-topic`: monitor an existing `Joy` stream
- `gamepad`: read a connected browser gamepad
- `keyboard`: emit `Joy` messages from panel-focused key input
- `interactive`: emit `Joy` messages from the custom controller UI

## Development

Install dependencies:

```bash
npm install
```

Build the extension:

```bash
npm run build
```

Install it into a local Foxglove Studio desktop setup:

```bash
npm run local-install
```

Package a `.foxe` bundle:

```bash
npm run foxglove:package
```

## Project layout

- `src/JoyPanel.tsx`: panel state, publishing, subscriptions, and input mode switching
- `src/components/`: visual controller views and layouts
- `src/controller-mappings/`: browser gamepad to ROS `Joy` mappings
- `src/hooks/useGamepad.ts`: browser gamepad polling hook

## Notes

- Keyboard control only applies while the panel is focused.
- Gamepad mappings are fail-closed: if the selected mapping does not match the connected controller, the panel neutralizes output instead of sending ambiguous commands.
