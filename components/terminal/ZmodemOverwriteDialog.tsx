import React, { useState } from "react";
import { useI18n } from "../../application/i18n/I18nProvider";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../ui/dialog";
import { Button } from "../ui/button";

interface Props {
  filename: string;
  onRespond: (action: "overwrite" | "skip" | "cancel", applyToRest: boolean) => void;
}

export const ZmodemOverwriteDialog: React.FC<Props> = ({ filename, onRespond }) => {
  const { t } = useI18n();
  const [applyToRest, setApplyToRest] = useState(false);
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onRespond("cancel", false); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("zmodem.overwrite.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground break-all">{filename}</p>
        <label className="flex items-center gap-2 text-sm mt-2">
          <input type="checkbox" checked={applyToRest} onChange={(e) => setApplyToRest(e.target.checked)} />
          {t("zmodem.overwrite.applyToRest")}
        </label>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onRespond("cancel", applyToRest)}>{t("zmodem.overwrite.cancel")}</Button>
          <Button variant="outline" onClick={() => onRespond("skip", applyToRest)}>{t("zmodem.overwrite.skip")}</Button>
          <Button onClick={() => onRespond("overwrite", applyToRest)}>{t("zmodem.overwrite.overwrite")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
