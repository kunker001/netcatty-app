import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider } from "../../application/i18n/I18nProvider.tsx";
import { normalizeTerminalSettings } from "../../domain/models/terminal.ts";
import type { Host, TerminalSession } from "../../types.ts";
import { TooltipProvider } from "../ui/tooltip.tsx";
import { SystemManagerSidePanel } from "./SystemManagerSidePanel.tsx";

const session: TerminalSession = {
  id: "session-1",
  hostId: "host-1",
  hostLabel: "Demo",
  username: "root",
  hostname: "demo.local",
  status: "connected",
  protocol: "ssh",
};

const host: Host = {
  id: "host-1",
  label: "Demo",
  hostname: "demo.local",
  username: "root",
  tags: [],
  os: "linux",
};

test("system side panel renders the graphical overview as the first tab", () => {
  const markup = renderToStaticMarkup(
    <I18nProvider locale="en">
      <TooltipProvider>
        <SystemManagerSidePanel
          session={session}
          sessionHost={host}
          isVisible={false}
          terminalSettings={normalizeTerminalSettings()}
          snippets={[]}
        />
      </TooltipProvider>
    </I18nProvider>,
  );

  assert.match(markup, /Overview/);
  assert.match(markup, /data-section="system-manager-overview"/);
  assert.doesNotMatch(markup, /Live server health/);
  assert.doesNotMatch(markup, /System overview/);
});

test("overview tab reuses the shared server stats source", () => {
  const source = readFileSync(new URL("./SystemOverviewTab.tsx", import.meta.url), "utf8");

  assert.match(source, /function MetricCard\(\{[\s\S]*trendValues,\s*trendMax,\s*tone,/);
  assert.match(source, /useServerStats\(\{/);
  assert.match(source, /setHistory\(\[\]\)/);
  assert.match(source, /if \(!isVisible \|\| !hasStats\) return/);
  assert.match(source, /SystemPanelInlineError[\s\S]*onRetry=\{\(\) => void refresh\(\)\}/);
  assert.match(source, /aggregateMountedDiskUsage\(stats\.disks\)/);
  assert.doesNotMatch(source, /stats\.disks\.slice\(/);
  assert.doesNotMatch(source, /usePolling/);
  assert.doesNotMatch(source, /backend\.getServerStats/);
});

test("overview network interfaces show cumulative RX/TX totals alongside rates", () => {
  const source = readFileSync(new URL("./SystemOverviewTab.tsx", import.meta.url), "utf8");

  assert.match(source, /stats\.netInterfaces\.slice\(0, 5\)\.map/);
  assert.match(source, /formatBytes\(iface\.rxBytes\)/);
  assert.match(source, /formatBytes\(iface\.txBytes\)/);
  assert.match(source, /formatThroughput\(iface\.rxSpeed\)/);
  assert.match(source, /formatThroughput\(iface\.txSpeed\)/);
});

test("overview tab stays mounted and only pauses polling while another system tab is active", () => {
  const source = readFileSync(new URL("./SystemManagerSidePanel.tsx", import.meta.url), "utf8");

  // Must not hard-unmount Overview on tab switch (causes empty-state flash).
  assert.doesNotMatch(source, /resolvedTab === 'overview' && \(/);
  assert.match(source, /isVisible=\{isVisible && resolvedTab === 'overview'\}/);
  assert.match(source, /<SystemOverviewTab/);
  assert.match(source, /resolvedTab !== 'overview' && 'hidden'/);
});

test("system manager tab bar switches icon-only from real overflow measure", () => {
  const source = readFileSync(new URL("./SystemManagerSidePanel.tsx", import.meta.url), "utf8");
  const indexCss = readFileSync(new URL("../../index.css", import.meta.url), "utf8");

  assert.match(source, /system-manager-tab-bar/);
  assert.match(source, /system-manager-tab-label/);
  assert.match(source, /measureSystemManagerTabBarLabeledFit/);
  assert.match(source, /resolveSystemManagerTabBarIconOnly/);
  assert.match(source, /SYSTEM_MANAGER_TAB_BAR_ICON_ONLY_CLASS/);
  assert.match(source, /scrollSystemManagerTabIntoView/);
  assert.match(source, /applyHorizontalWheelToScrollContainer/);
  assert.match(indexCss, /\.system-manager-tab-bar--icon-only \.system-manager-tab-label\s*\{[\s\S]*display:\s*none/);
  assert.doesNotMatch(indexCss, /@container system-manager-tabs/);
});

test("system manager tab bar reuses toolbar customize context menu", () => {
  const source = readFileSync(new URL("./SystemManagerSidePanel.tsx", import.meta.url), "utf8");

  assert.match(source, /ToolbarCustomizeContextMenu/);
  assert.match(source, /ToolbarOverflowMenu/);
  assert.match(source, /useToolbarItemLayout/);
  assert.match(source, /STORAGE_KEY_SYSTEM_MANAGER_TAB_LAYOUT/);
  assert.match(source, /SYSTEM_MANAGER_TAB_LAYOUT_DEFAULTS/);
  assert.match(source, /handleSetTabPlacement/);
  assert.match(source, /tabLayout\.move/);
  assert.match(source, /data-section="system-manager-tabs"/);
  assert.match(source, /system-manager-tab-overflow/);
});
