import { ExtensionContext } from "@foxglove/extension";

import { initAmrSweeperPanel } from "./AmrSweeperPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "amr-sweeper-panel", initPanel: initAmrSweeperPanel });
}
