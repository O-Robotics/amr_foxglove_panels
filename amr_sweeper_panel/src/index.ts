import { ExtensionContext } from "@foxglove/extension";

import { initAmrSweeperPanel } from "./AmrSweeperPanel";

export function activate(extensionContext: ExtensionContext): void {
  extensionContext.registerPanel({ name: "amr_sweeper_panel", initPanel: initAmrSweeperPanel });
}
