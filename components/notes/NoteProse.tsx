import React from "react";

type NoteProseProps = {
  className?: string;
  children: React.ReactNode;
};

/** Plain-text note/help prose. Replaces the deleted streamdown AI markdown renderer. */
export const NoteProse: React.FC<NoteProseProps> = ({ className, children }) => (
  <div className={className} style={{ whiteSpace: "pre-wrap" }}>
    {children}
  </div>
);
