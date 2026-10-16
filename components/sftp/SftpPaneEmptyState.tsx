import React from "react";
import { HardDrive, Monitor, Plus } from "lucide-react";
import { Button } from "../ui/button";
import { SftpHostPicker } from "./SftpHostPicker";
import type { Host } from "../../domain/models";
import type { SftpConnectedHostEntry } from "../../domain/sftpConnectedHosts";
import type { SftpConnectHostOptions, SftpConnectTarget } from "./SftpContext";

interface SftpPaneEmptyStateProps {
  side: "left" | "right";
  showEmptyHeader: boolean;
  t: (key: string, params?: Record<string, unknown>) => string;
  showHostPicker: boolean;
  setShowHostPicker: (open: boolean) => void;
  hostSearch: string;
  setHostSearch: (value: string) => void;
  hosts: Host[];
  connectedHosts?: SftpConnectedHostEntry[];
  onConnect: (host: SftpConnectTarget, options?: SftpConnectHostOptions) => void;
}

export const SftpPaneEmptyState: React.FC<SftpPaneEmptyStateProps> = ({
  side,
  showEmptyHeader,
  t,
  showHostPicker,
  setShowHostPicker,
  hostSearch,
  setHostSearch,
  hosts,
  connectedHosts = [],
  onConnect,
}) => {
  return (
    <div className="absolute inset-0 flex flex-col">
      {showEmptyHeader && (
        <div className="h-12 px-4 border-b border-border/60 flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            {side === "left" ? <Monitor size={14} /> : <HardDrive size={14} />}
            <span>
              {side === "left" ? t("sftp.pane.local") : t("sftp.pane.remote")}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 px-3"
            onClick={() => setShowHostPicker(true)}
          >
            <Plus size={14} className="mr-2" /> {t("sftp.pane.selectHost")}
          </Button>
        </div>
      )}

      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 p-6">
        <div className="h-14 w-14 rounded-xl bg-secondary/60 text-primary flex items-center justify-center">
          {side === "left" ? <Monitor size={24} /> : <HardDrive size={24} />}
        </div>
        <div>
          <div className="text-sm font-semibold mb-1">
            {t("sftp.pane.selectHostToStart")}
          </div>
          <div className="text-xs text-muted-foreground">
            {t("sftp.pane.chooseFilesystem")}
          </div>
        </div>
        <Button onClick={() => setShowHostPicker(true)}>
          <Plus size={14} className="mr-2" /> {t("sftp.pane.selectHost")}
        </Button>
      </div>

      <SftpHostPicker
        open={showHostPicker}
        onOpenChange={setShowHostPicker}
        hosts={hosts}
        connectedHosts={connectedHosts}
        side={side}
        hostSearch={hostSearch}
        onHostSearchChange={setHostSearch}
        onSelectLocal={() => onConnect("local")}
        onSelectHost={onConnect}
      />
    </div>
  );
};
