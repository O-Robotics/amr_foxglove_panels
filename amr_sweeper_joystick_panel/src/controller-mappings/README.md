# Controller Mappings

Controller mapping files describe how browser `Gamepad` inputs become outgoing
ROS `sensor_msgs/msg/Joy` values.

These files are intentionally separate from display mappings. Display mappings
only describe where controls appear on screen; controller mappings are the
source of truth for robot control behavior.

## File Shape

- `match` identifies which connected browser gamepad the config applies to.
- `output.axes` and `output.buttons` define the outgoing Joy layout.
- `axisMappings` map browser axes, analog button values, or button pairs to Joy
  axes.
- `buttonMappings` map browser buttons to Joy buttons.

For PlayStation controllers using the browser standard mapping, the usual input
indices are:

| Control | Browser input |
| --- | --- |
| Left stick X/Y | axes 0/1 |
| Right stick X/Y | axes 2/3 |
| Cross, Circle, Square, Triangle | buttons 0, 1, 2, 3 |
| L1, R1 | buttons 4, 5 |
| L2, R2 | buttons 6, 7 |
| Share/Create, Options | buttons 8, 9 |
| L3, R3 | buttons 10, 11 |
| D-pad up, down, left, right | buttons 12, 13, 14, 15 |
| PS/Home, touchpad | buttons 16, 17 |

When a controller variant reports different indices, create another JSON file
with the same output layout and adjusted `source` values.
