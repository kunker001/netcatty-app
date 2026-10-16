import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { FileText, Download, Palette, X } from "lucide-react";
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../application/i18n/I18nProvider";
import { cn } from "../lib/utils";
import { ConnectionLog, TerminalTheme } from "../types";
import { TERMINAL_THEMES } from "../infrastructure/config/terminalThemes";
import { useCustomThemes } from "../application/state/customThemeStore";
import { useAppearanceChromeStore } from "../application/state/appearanceChromeStore";
import { applyCustomAccentToTerminalTheme } from "../domain/terminalAppearance";
import { Button } from "./ui/button";
import ThemeCustomizeModal from "./terminal/ThemeCustomizeModal";

interface LogViewProps {
    log: ConnectionLog;
    defaultTerminalTheme: TerminalTheme;
    defaultFontSize: number;
    isVisible: boolean;
    onClose: () => void;
    onUpdateLog: (logId: string, updates: Partial<ConnectionLog>) => void;
}

const LogViewComponent: React.FC<LogViewProps> = ({
    log,
    defaultTerminalTheme,
    defaultFontSize,
    isVisible,
    onClose,
    onUpdateLog,
}) => {
    const { t, resolvedLocale } = useI18n();
    const containerRef = useRef<HTMLDivElement>(null);
    const termRef = useRef<XTerm | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const [isReady, setIsReady] = useState(false);
    const [themeModalOpen, setThemeModalOpen] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [previewTheme, setPreviewTheme] = useState<TerminalTheme | null>(null);

    // Subscribe to custom theme changes so editing triggers re-render
    const customThemes = useCustomThemes();
    // Leaf accent: published defaultTerminalTheme is the stable base catalog
    // theme; apply live custom accent here so log replay matches terminal chrome
    // without thrashing AppShell on every HSL tick.
    const { accentMode, customAccent } = useAppearanceChromeStore();
    const explicitThemeId = useMemo(() => {
        if (!log.themeId) return undefined;
        const exists = TERMINAL_THEMES.some((theme) => theme.id === log.themeId)
            || customThemes.some((theme) => theme.id === log.themeId);
        return exists ? log.themeId : undefined;
    }, [customThemes, log.themeId]);

    useEffect(() => {
        if (log.themeId && !explicitThemeId) {
            onUpdateLog(log.id, { themeId: undefined });
        }
    }, [explicitThemeId, log.id, log.themeId, onUpdateLog]);

    // Use log's saved theme/fontSize or fall back to defaults
    const currentTheme = useMemo(() => {
        if (previewTheme) {
            return previewTheme;
        }
        const baseTheme = explicitThemeId
            ? (TERMINAL_THEMES.find(t => t.id === explicitThemeId)
                || customThemes.find(t => t.id === explicitThemeId)
                || defaultTerminalTheme)
            : defaultTerminalTheme;
        return applyCustomAccentToTerminalTheme(baseTheme, accentMode, customAccent);
    }, [accentMode, customAccent, customThemes, defaultTerminalTheme, explicitThemeId, previewTheme]);

    const currentFontSize = log.fontSize ?? defaultFontSize;

    // Format date for display
    const formattedDate = useMemo(() => {
        const date = new Date(log.startTime);
        return date.toLocaleString(resolvedLocale || undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }, [log.startTime, resolvedLocale]);

    // Handle theme change
    const handleThemeChange = useCallback((themeId: string) => {
        onUpdateLog(log.id, { themeId });
    }, [log.id, onUpdateLog]);

    useEffect(() => {
        if (!themeModalOpen) {
            setPreviewTheme(null);
        }
    }, [themeModalOpen]);

    // Handle font size change
    const handleFontSizeChange = useCallback((fontSize: number) => {
        onUpdateLog(log.id, { fontSize });
    }, [log.id, onUpdateLog]);

    // Handle export
    const handleExport = useCallback(async () => {
        if (!log.terminalData || isExporting) return;

        setIsExporting(true);
        try {
            const { netcattyBridge } = await import("../infrastructure/services/netcattyBridge");
            const bridge = netcattyBridge.get();
            if (bridge?.exportSessionLog) {
                await bridge.exportSessionLog({
                    terminalData: log.terminalData,
                    hostLabel: log.hostLabel,
                    hostname: log.hostname,
                    startTime: log.startTime,
                    format: 'txt',
                });
            }
        } catch (err) {
            console.error('Failed to export session log:', err);
        } finally {
            setIsExporting(false);
        }
    }, [log.terminalData, log.hostLabel, log.hostname, log.startTime, isExporting]);

    // Initialize terminal
    useEffect(() => {
        if (!containerRef.current || !isVisible) return;

        // Create terminal
        const term = new XTerm({
            fontFamily: '"JetBrains Mono", "SF Mono", Monaco, Menlo, monospace',
            fontSize: currentFontSize,
            cursorBlink: false,
            cursorStyle: "underline",
            allowProposedApi: true,
            disableStdin: true, // Read-only mode
            theme: currentTheme.colors,
            scrollback: 10000,
        });

        termRef.current = term;

        // Create fit addon
        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        // Open terminal
        term.open(containerRef.current);

        // Try to load WebGL addon for better performance
        try {
            const webglAddon = new WebglAddon();
            term.loadAddon(webglAddon);
        } catch {
            // WebGL not available, canvas renderer will be used
        }

        // Fit terminal
        const initialFitTimer = setTimeout(() => {
            try {
                fitAddon.fit();
            } catch {
                // Ignore fit errors
            }
        }, 50);

        // Write terminal data if available
        if (log.terminalData) {
            term.write(log.terminalData);
        } else {
            // No terminal data available
            term.writeln("\x1b[2m--- No terminal data captured for this session ---\x1b[0m");
            term.writeln("");
            term.writeln(`\x1b[36mHost:\x1b[0m ${log.hostname}`);
            term.writeln(`\x1b[36mUser:\x1b[0m ${log.username}`);
            term.writeln(`\x1b[36mProtocol:\x1b[0m ${log.protocol}`);
            term.writeln(`\x1b[36mTime:\x1b[0m ${formattedDate}`);
            if (log.endTime) {
                const duration = Math.round((log.endTime - log.startTime) / 1000);
                const minutes = Math.floor(duration / 60);
                const seconds = duration % 60;
                term.writeln(`\x1b[36mDuration:\x1b[0m ${minutes}m ${seconds}s`);
            }
        }

        setIsReady(true);

        // Cleanup
        return () => {
            clearTimeout(initialFitTimer);
            term.dispose();
            termRef.current = null;
            fitAddonRef.current = null;
            setIsReady(false);
        };
        // Only re-create terminal when visibility or terminalData changes
        // Theme and font size updates are handled separately
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isVisible, log.id, log.terminalData]);

    // Update theme instantly without recreating terminal
    useEffect(() => {
        if (termRef.current && isReady) {
            termRef.current.options.theme = currentTheme.colors;
        }
    }, [currentTheme, isReady]);

    // Update font size instantly without recreating terminal
    useEffect(() => {
        if (!termRef.current || !isReady) return;
        termRef.current.options.fontSize = currentFontSize;
        // Refit after font size change
        const refitTimer = setTimeout(() => {
            try {
                fitAddonRef.current?.fit();
            } catch {
                // Ignore fit errors
            }
        }, 10);
        return () => clearTimeout(refitTimer);
    }, [currentFontSize, isReady]);

    // Handle resize
    useEffect(() => {
        if (!isVisible || !fitAddonRef.current) return;

        const handleResize = () => {
            if (fitAddonRef.current) {
                try {
                    fitAddonRef.current.fit();
                } catch {
                    // Ignore fit errors
                }
            }
        };

        const resizeObserver = new ResizeObserver(handleResize);
        if (containerRef.current?.parentElement) {
            resizeObserver.observe(containerRef.current.parentElement);
        }

        return () => {
            resizeObserver.disconnect();
        };
    }, [isVisible]);

    const isLocal = log.protocol === "local" || log.hostname === "localhost";

    return (
        <div className="h-full w-full flex flex-col bg-background">
            {/* Header */}
            <div className="flex h-9 items-center justify-between gap-3 px-3 py-1 border-b border-border/50 bg-secondary/30 shrink-0">
                <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div
                        className={cn(
                            "h-6 w-6 shrink-0 rounded-md flex items-center justify-center",
                            isLocal
                                ? "bg-emerald-500/10 text-emerald-500"
                                : "bg-blue-500/10 text-blue-500"
                        )}
                    >
                        <FileText size={14} />
                    </div>
                    <div className="flex min-w-0 flex-1 items-baseline gap-2">
                        <div className="min-w-0 text-sm font-medium leading-5 truncate">
                            {isLocal ? t("logs.localTerminal") : log.hostname}
                        </div>
                        <div className="text-xs leading-4 truncate text-muted-foreground">
                            {formattedDate} • {log.localUsername}@{log.localHostname}
                        </div>
                    </div>
                </div>
                <div className="flex h-7 shrink-0 items-center gap-1.5">
                    {/* Export button */}
                    {log.terminalData && (
                        <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 h-7 px-2 text-xs"
                            onClick={handleExport}
                            disabled={isExporting}
                        >
                            <Download size={14} />
                            <span className="text-xs">{t("logView.export")}</span>
                        </Button>
                    )}

                    {/* Theme & font customization button */}
                    <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 h-7 px-2 text-xs"
                        onClick={() => setThemeModalOpen(true)}
                    >
                        <Palette size={14} />
                        <span className="text-xs">{t("logView.appearance")}</span>
                    </Button>

                    <span className="h-6 inline-flex items-center rounded bg-secondary px-2 text-xs text-muted-foreground">
                        {t("logView.readOnly")}
                    </span>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
                        <X size={14} />
                    </Button>
                </div>
            </div>

            {/* Terminal container */}
            <div
                className="flex-1 overflow-hidden p-2"
                style={{ backgroundColor: currentTheme?.colors?.background || '#000000' }}
            >
                <div ref={containerRef} className="h-full w-full" />
            </div>

            {/* Theme Customize Modal */}
            <ThemeCustomizeModal
                open={themeModalOpen}
                onClose={() => setThemeModalOpen(false)}
                currentThemeId={explicitThemeId}
                displayThemeId={currentTheme.id}
                currentFontSize={currentFontSize}
                onThemeChange={handleThemeChange}
                onThemeReset={() => onUpdateLog(log.id, { themeId: undefined })}
                onFontSizeChange={handleFontSizeChange}
                onPreviewThemeChange={setPreviewTheme}
            />
        </div>
    );
};

// Memoization comparison
const logViewAreEqual = (prev: LogViewProps, next: LogViewProps): boolean => {
    return (
        prev.log.id === next.log.id &&
        prev.log.themeId === next.log.themeId &&
        prev.log.fontSize === next.log.fontSize &&
        prev.isVisible === next.isVisible &&
        prev.defaultFontSize === next.defaultFontSize &&
        prev.defaultTerminalTheme.id === next.defaultTerminalTheme.id
    );
};

export default memo(LogViewComponent, logViewAreEqual);
