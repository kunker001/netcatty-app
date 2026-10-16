import { CheckSquare, FolderTree, Search, Square } from 'lucide-react';
import React, { useMemo, useState } from 'react';
import { useI18n } from '@/application/i18n/I18nProvider';
import type { Host } from '@/domain/models';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { FixedSizeVirtualList } from '@/components/ui/FixedSizeVirtualList';
import { cn } from '@/lib/utils';

export interface SelectGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  hosts: Host[];
  customGroups?: string[];
  selectedGroupPaths: string[];
  onSelectionChange: (selectedGroupPaths: string[]) => void;
}

const GROUP_ROW_HEIGHT = 48;

function collectGroupPaths(
  hosts: Host[],
  customGroups: string[],
  selectedGroupPaths: string[],
): string[] {
  const paths = new Set<string>();
  for (const groupPath of [...customGroups, ...selectedGroupPaths]) {
    const parts = groupPath.split('/').filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      paths.add(parts.slice(0, index).join('/'));
    }
  }
  for (const host of hosts) {
    const parts = host.group?.split('/').filter(Boolean) ?? [];
    for (let index = 1; index <= parts.length; index += 1) {
      paths.add(parts.slice(0, index).join('/'));
    }
  }
  return [...paths].sort((left, right) => left.localeCompare(right));
}

function countHostsByGroupPath(hosts: Host[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const host of hosts) {
    if (host.protocol === 'serial') continue;
    const parts = host.group?.split('/').filter(Boolean) ?? [];
    for (let index = 1; index <= parts.length; index += 1) {
      const path = parts.slice(0, index).join('/');
      counts.set(path, (counts.get(path) ?? 0) + 1);
    }
  }
  return counts;
}

export const SelectGroupDialog: React.FC<SelectGroupDialogProps> = ({
  open,
  onOpenChange,
  hosts,
  customGroups = [],
  selectedGroupPaths,
  onSelectionChange,
}) => {
  const { t } = useI18n();
  const [searchQuery, setSearchQuery] = useState('');
  const selected = useMemo(() => new Set(selectedGroupPaths), [selectedGroupPaths]);
  const groupPaths = useMemo(
    () => collectGroupPaths(hosts, customGroups, selectedGroupPaths),
    [customGroups, hosts, selectedGroupPaths],
  );
  const displayedPaths = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    if (!query) return groupPaths;
    return groupPaths.filter((path) => path.toLocaleLowerCase().includes(query));
  }, [groupPaths, searchQuery]);
  const hostCountByPath = useMemo(() => countHostsByGroupPath(hosts), [hosts]);

  const togglePath = (path: string) => {
    if (selected.has(path)) {
      onSelectionChange(selectedGroupPaths.filter((candidate) => candidate !== path));
      return;
    }
    onSelectionChange([...selectedGroupPaths, path]);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md h-[min(78vh,600px)] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-3 shrink-0 border-b border-border/60">
          <DialogTitle className="text-base">{t('snippets.targets.selectGroups')}</DialogTitle>
        </DialogHeader>

        <div className="px-4 py-3 border-b border-border/60 shrink-0">
          <div className="relative">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder={t('common.searchPlaceholder')}
              className="h-8 pl-8"
            />
          </div>
        </div>

        <div className="flex-1 min-h-0 p-3">
          {displayedPaths.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('snippets.targets.noGroups')}
            </p>
          ) : (
            <FixedSizeVirtualList
              className="h-full"
              items={displayedPaths}
              itemHeight={GROUP_ROW_HEIGHT}
              getItemKey={(path) => path}
              renderItem={(path) => {
                const isSelected = selected.has(path);
                const depth = Math.max(0, path.split('/').filter(Boolean).length - 1);
                const label = path.split('/').filter(Boolean).pop() ?? path;
                const hostCount = hostCountByPath.get(path) ?? 0;
                return (
                  <button
                    type="button"
                    className={cn(
                      'w-full h-11 flex items-center gap-2.5 rounded-lg px-2.5 text-left transition-colors',
                      isSelected ? 'bg-primary/10 text-foreground' : 'hover:bg-muted/70',
                    )}
                    style={{ paddingLeft: `${10 + depth * 16}px` }}
                    onClick={() => togglePath(path)}
                  >
                    {isSelected ? (
                      <CheckSquare size={16} className="text-primary shrink-0" />
                    ) : (
                      <Square size={16} className="text-muted-foreground shrink-0" />
                    )}
                    <FolderTree size={16} className="text-primary shrink-0" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{path}</span>
                    </span>
                    <span className="text-[11px] text-muted-foreground shrink-0">
                      {t('vault.groups.hostsCount', { count: hostCount })}
                    </span>
                  </button>
                );
              }}
            />
          )}
        </div>

        <DialogFooter className="px-4 py-3 border-t border-border/60 shrink-0">
          <Button className="w-full" onClick={() => onOpenChange(false)}>
            {t('selectHost.continueWithCount', { count: selectedGroupPaths.length })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
