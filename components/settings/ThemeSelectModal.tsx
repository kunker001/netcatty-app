/**
 * Theme Select Modal
 * A modal dialog for selecting terminal themes in settings
 */

import React, { useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Palette, X } from 'lucide-react';
import { useI18n } from '../../application/i18n/I18nProvider';
import { Button } from '../ui/button';
import { ThemeList } from '../ThemeList';

interface ThemeSelectModalProps {
    open: boolean;
    onClose: () => void;
    selectedThemeId: string;
    onSelect: (themeId: string) => void;
    filterType?: 'dark' | 'light';
    showAutoOption?: boolean;
}

export const ThemeSelectModal: React.FC<ThemeSelectModalProps> = ({
    open,
    onClose,
    selectedThemeId,
    onSelect,
    filterType,
    showAutoOption,
}) => {
    const { t } = useI18n();

    // Handle theme selection - select and close
    const handleThemeSelect = useCallback((themeId: string) => {
        onSelect(themeId);
        onClose();
    }, [onSelect, onClose]);

    // Handle ESC key
    React.useEffect(() => {
        if (!open) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open, onClose]);

    // Handle backdrop click
    const handleBackdropClick = useCallback((e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onClose();
    }, [onClose]);

    if (!open) return null;

    const modalTitleId = 'theme-select-modal-title';

    const modalContent = (
        <div
            className="fixed inset-0 flex items-center justify-center bg-black/60"
            style={{ zIndex: 99999 }}
            onClick={handleBackdropClick}
            role="dialog"
            aria-modal="true"
            aria-labelledby={modalTitleId}
        >
            <div
                className="w-[480px] max-h-[600px] bg-background border border-border rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-3 shrink-0 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-primary/10">
                            <Palette size={16} className="text-primary" />
                        </div>
                        <h2 id={modalTitleId} className="text-sm font-semibold text-foreground">{t('settings.terminal.themeModal.title')}</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        aria-label={t('common.close')}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Theme List */}
                <div className="flex-1 min-h-0 overflow-y-auto p-4">
                    <ThemeList
                        selectedThemeId={selectedThemeId}
                        onSelect={handleThemeSelect}
                        filterType={filterType}
                        showAutoOption={showAutoOption}
                    />
                </div>

                {/* Footer */}
                <div className="flex justify-end px-5 py-3 shrink-0 border-t border-border bg-muted/20">
                    <Button
                        variant="ghost"
                        onClick={onClose}
                    >
                        {t('common.cancel')}
                    </Button>
                </div>
            </div>
        </div>
    );

    // Use Portal to render at document root
    return createPortal(modalContent, document.body);
};

export default ThemeSelectModal;
