import { Button, LinearProgress } from "@mui/material";

import type { Joy } from "../types";

// TODO copy theming from another extension

export function SimpleButtonView(props: { joy: Joy | undefined }) {
  const buttons = props.joy
    ? props.joy.buttons.map((item, index) => (
        <Button
          key={index}
          variant={item > 0 ? "contained" : "outlined"}
          size="large"
          color={item > 0 ? "error" : "primary"}
        >
          {index}
        </Button>
      ))
    : [];

  const axes = props.joy
    ? props.joy.axes.map((item, index) => (
        <LinearProgress
          key={index}
          variant="determinate"
          value={item * 50 + 50}
          sx={{ transition: "none" }}
        />
      ))
    : [];

  return (
    <div>
      {props.joy ? null : "Waiting for first data..."}
      {buttons}
      {axes}
      {/* {JSON.stringify(props.joy)} */}
    </div>
  );
}
