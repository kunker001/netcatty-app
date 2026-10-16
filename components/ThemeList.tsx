/**
 * Shared theme list component used by both ThemeSelectPanel and ThemeSelectModal
 */
import React, { memo, useMemo } from 'react';
import { Check, Wand2 } from 'lucide-react';
import { useI18n } from '../application/i18n/I18nProvider';
import { TERMINAL_THEMES, USER_VISIBLE_TERMINAL_THEMES, isUiMatchTerminalThemeId } from '../infrastructure/config/terminalThemes';
import { TERMINAL_THEME_AUTO } from '../domain/terminalAppearance';
import { useCustomThemes } from '../application/state/customThemeStore';
import { cn } from '../lib/utils';
import { TerminalTheme } from '../types';

// Memoized theme item component
const ThemeItem = memo(({
    theme,
    isSelected,
    onSelect
}: {
    theme: TerminalTheme;
    isSelected: boolean;
    onSelect: (id: string) => void;
}) => (
    <button
        onClick={() => onSelect(theme.id)}
        className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 text-left transition-all',
            isSelected
                ? 'bg-primary/10'
                : 'hover:bg-muted'
        )}
    >
        {/* Color swatch preview */}
        <div
            className="w-12 h-8 rounded-[4px] flex-shrink-0 flex flex-col justify-center items-start pl-1.5 gap-0.5 border border-border/50"
            style={{ backgroundColor: theme.colors.background }}
        >
            <div className="h-1 w-4 rounded-full" style={{ backgroundColor: theme.colors.green }} />
            <div className="h-1 w-6 rounded-full" style={{ backgroundColor: theme.colors.blue }} />
            <div className="h-1 w-3 rounded-full" style={{ backgroundColor: theme.colors.yellow }} />
        </div>
        <div className="flex-1 min-w-0">
            <div className={cn('text-sm font-medium truncate', isSelected ? 'text-primary' : 'text-foreground')}>
                {theme.name}
            </div>
            <div className="text-[10px] text-muted-foreground capitalize">{theme.type}</div>
        </div>
        {isSelected && (
            <Check size={16} className="text-primary flex-shrink-0" />
        )}
    </button>
));
ThemeItem.displayName = 'ThemeItem';

interface ThemeListProps {
    selectedThemeId: string;
    onSelect: (themeId: string) => void;
    /** Restrict the list to a single type; omit to show both sections. */
    filterType?: 'dark' | 'light';
    /** Render an "Auto (match app theme)" entry at the top. */
    showAutoOption?: boolean;
}

export const ThemeList: React.FC<ThemeListProps> = ({ selectedThemeId, onSelect, filterType, showAutoOption }) => {
    const { t } = useI18n();
    const customThemes = useCustomThemes();
    const deletedSelectedTheme = useMemo(
        () => (selectedThemeId
            && selectedThemeId !== TERMINAL_THEME_AUTO
            && !isUiMatchTerminalThemeId(selectedThemeId)
            && !TERMINAL_THEMES.some((theme) => theme.id === selectedThemeId)
            && !customThemes.some((theme) => theme.id === selectedThemeId)
            ? selectedThemeId
            : null),
        [customThemes, selectedThemeId],
    );
    const hiddenSelectedTheme = useMemo(
        () => (isUiMatchTerminalThemeId(selectedThemeId)
            ? TERMINAL_THEMES.find(theme => theme.id === selectedThemeId) || null
            : null),
        [selectedThemeId],
    );

    const { darkThemes, lightThemes } = useMemo(() => {
        const dark = USER_VISIBLE_TERMINAL_THEMES.filter(t => t.type === 'dark');
        const light = USER_VISIBLE_TERMINAL_THEMES.filter(t => t.type === 'light');
        return { darkThemes: dark, lightThemes: light };
    }, []);

    const visibleCustomThemes = filterType
        ? customThemes.filter(theme => theme.type === filterType)
        : customThemes;
    const isAutoSelected = selectedThemeId === TERMINAL_THEME_AUTO;

    return (
        <>
            {showAutoOption && (
                <button
                    onClick={() => onSelect(TERMINAL_THEME_AUTO)}
                    className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 mb-3 rounded-md text-left transition-all',
                        isAutoSelected ? 'bg-primary/10' : 'hover:bg-muted',
                    )}
                >
                    <div className="w-12 h-8 rounded-[4px] flex-shrink-0 flex items-center justify-center border border-border/50 bg-gradient-to-br from-muted to-background">
                        <Wand2 size={14} className="text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className={cn('text-sm font-medium truncate', isAutoSelected ? 'text-primary' : 'text-foreground')}>
                            {t('settings.terminal.theme.auto')}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{t('settings.terminal.theme.autoDesc')}</div>
                    </div>
                    {isAutoSelected && <Check size={16} className="text-primary flex-shrink-0" />}
                </button>
            )}
            {hiddenSelectedTheme && (
                <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                        {t('terminal.hiddenTheme.title')}
                    </div>
                    <div className="text-sm font-medium text-foreground">{hiddenSelectedTheme.name}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                        {t('terminal.hiddenTheme.desc')}
                    </div>
                </div>
            )}
            {deletedSelectedTheme && (
                <div className="mb-4 rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-semibold">
                        Missing Theme
                    </div>
                    <div className="text-sm font-medium text-foreground">{deletedSelectedTheme}</div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                        This custom theme is no longer available. Pick another theme to replace it.
                    </div>
                </div>
            )}
            {/* Dark Themes Section */}
            {(!filterType || filterType === 'dark') && (
            <div className="mb-4">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold px-3">
                    {t('settings.terminal.themeModal.darkThemes')}
                </div>
                <div className="space-y-1">
                    {darkThemes.map(theme => (
                        <ThemeItem
                            key={theme.id}
                            theme={theme}
                            isSelected={selectedThemeId === theme.id}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            </div>
            )}

            {/* Light Themes Section */}
            {(!filterType || filterType === 'light') && (
            <div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold px-3">
                    {t('settings.terminal.themeModal.lightThemes')}
                </div>
                <div className="space-y-1">
                    {lightThemes.map(theme => (
                        <ThemeItem
                            key={theme.id}
                            theme={theme}
                            isSelected={selectedThemeId === theme.id}
                            onSelect={onSelect}
                        />
                    ))}
                </div>
            </div>
            )}

            {/* Custom Themes Section */}
            {visibleCustomThemes.length > 0 && (
                <div className="mt-4">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 font-semibold px-3">
                        {t('terminal.customTheme.section')}
                    </div>
                    <div className="space-y-1">
                        {visibleCustomThemes.map(theme => (
                            <ThemeItem
                                key={theme.id}
                                theme={theme}
                                isSelected={selectedThemeId === theme.id}
                                onSelect={onSelect}
                            />
                        ))}
                    </div>
                </div>
            )}
        </>
    );
};
