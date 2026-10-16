/**
 * SFTP Permissions Editor Dialog
 */

import React, { memo, useEffect, useState } from 'react';
import { useI18n } from '../../application/i18n/I18nProvider';
import { SftpFileEntry } from '../../types';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';

interface SftpPermissionsDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    file: SftpFileEntry | null;
    onSave: (file: SftpFileEntry, permissions: string) => void;
}

const SftpPermissionsDialogInner: React.FC<SftpPermissionsDialogProps> = ({ open, onOpenChange, file, onSave }) => {
    const { t } = useI18n();
    const [permissions, setPermissions] = useState({
        owner: { read: false, write: false, execute: false },
        group: { read: false, write: false, execute: false },
        others: { read: false, write: false, execute: false },
    });

    // Parse permissions from file
    // Supports both symbolic format (rwxr-xr-x) and octal format (755)
    useEffect(() => {
        if (file?.permissions) {
            const perms = file.permissions;

            // Check if it's octal format (e.g., "755", "644")
            if (/^[0-7]{3,4}$/.test(perms)) {
                const octal = perms.length === 4 ? perms.slice(1) : perms;
                const ownerBits = parseInt(octal[0], 10);
                const groupBits = parseInt(octal[1], 10);
                const othersBits = parseInt(octal[2], 10);
                setPermissions({
                    owner: {
                        read: (ownerBits & 4) !== 0,
                        write: (ownerBits & 2) !== 0,
                        execute: (ownerBits & 1) !== 0,
                    },
                    group: {
                        read: (groupBits & 4) !== 0,
                        write: (groupBits & 2) !== 0,
                        execute: (groupBits & 1) !== 0,
                    },
                    others: {
                        read: (othersBits & 4) !== 0,
                        write: (othersBits & 2) !== 0,
                        execute: (othersBits & 1) !== 0,
                    },
                });
                return;
            }

            // Parse symbolic rwxrwxrwx format (skip first char for type)
            const pStr = perms.length === 10 ? perms.slice(1) : perms;
            if (pStr.length >= 9) {
                setPermissions({
                    owner: {
                        read: pStr[0] === 'r',
                        write: pStr[1] === 'w',
                        execute: pStr[2] === 'x' || pStr[2] === 's',
                    },
                    group: {
                        read: pStr[3] === 'r',
                        write: pStr[4] === 'w',
                        execute: pStr[5] === 'x' || pStr[5] === 's',
                    },
                    others: {
                        read: pStr[6] === 'r',
                        write: pStr[7] === 'w',
                        execute: pStr[8] === 'x' || pStr[8] === 't',
                    },
                });
            }
        }
    }, [file]);

    const togglePerm = (role: 'owner' | 'group' | 'others', perm: 'read' | 'write' | 'execute') => {
        setPermissions(prev => ({
            ...prev,
            [role]: { ...prev[role], [perm]: !prev[role][perm] }
        }));
    };

    const getOctalPermissions = (): string => {
        const getNum = (p: { read: boolean; write: boolean; execute: boolean }) =>
            (p.read ? 4 : 0) + (p.write ? 2 : 0) + (p.execute ? 1 : 0);
        return `${getNum(permissions.owner)}${getNum(permissions.group)}${getNum(permissions.others)}`;
    };

    const getSymbolicPermissions = (): string => {
        const getSym = (p: { read: boolean; write: boolean; execute: boolean }) =>
            `${p.read ? 'r' : '-'}${p.write ? 'w' : '-'}${p.execute ? 'x' : '-'}`;
        return getSym(permissions.owner) + getSym(permissions.group) + getSym(permissions.others);
    };

    const handleSave = () => {
        if (file) {
            onSave(file, getOctalPermissions());
            onOpenChange(false);
        }
    };

    if (!file) return null;

    const permLabel = (perm: 'read' | 'write' | 'execute') => (perm === 'read' ? 'R' : perm === 'write' ? 'W' : 'X');

    const PermRow = ({ role, label }: { role: 'owner' | 'group' | 'others'; label: string }) => (
        <div className="flex items-center gap-4">
            <div className="w-16 text-sm font-medium">{label}</div>
            <div className="flex gap-3">
                {(['read', 'write', 'execute'] as const).map(perm => (
                    <label key={perm} className="flex items-center gap-1.5 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={permissions[role][perm]}
                            onChange={() => togglePerm(role, perm)}
                            className="rounded border-border"
                        />
                        <span className="text-xs">{permLabel(perm)}</span>
                    </label>
                ))}
            </div>
        </div>
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[400px]">
                <DialogHeader>
                    <DialogTitle>{t('sftp.permissions.title')}</DialogTitle>
                    <DialogDescription className="truncate">
                        {file.name}
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4 py-4">
                    <div className="space-y-3">
                        <PermRow role="owner" label={t('sftp.permissions.owner')} />
                        <PermRow role="group" label={t('sftp.permissions.group')} />
                        <PermRow role="others" label={t('sftp.permissions.others')} />
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-border/60">
                        <div className="text-xs text-muted-foreground">
                            {t('sftp.permissions.octal')}: <span className="font-mono text-foreground">{getOctalPermissions()}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                            {t('sftp.permissions.symbolic')}: <span className="font-mono text-foreground">{getSymbolicPermissions()}</span>
                        </div>
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>
                        {t('common.cancel')}
                    </Button>
                    <Button onClick={handleSave}>
                        {t('common.apply')}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
};

export const SftpPermissionsDialog = memo(SftpPermissionsDialogInner);
SftpPermissionsDialog.displayName = 'SftpPermissionsDialog';
