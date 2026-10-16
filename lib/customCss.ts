const CUSTOM_CSS_STYLE_ID = 'netcatty-custom-css';

/** Inject or update the user custom CSS style block in document.head. */
export function applyCustomCssToDocument(css: string): void {
  if (typeof document === 'undefined') return;

  let styleEl = document.getElementById(CUSTOM_CSS_STYLE_ID) as HTMLStyleElement | null;
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = CUSTOM_CSS_STYLE_ID;
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = css;
}
