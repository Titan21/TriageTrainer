// One shared modal <dialog>. Native showModal() gives focus trapping, Escape to close and a backdrop.

let dlg: HTMLDialogElement | null = null;
let returnKey: string | undefined;
let handler: ((el: HTMLElement, close: () => void) => void) | null = null;

function ensure(): HTMLDialogElement {
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.className = 'dlg';
  document.body.append(dlg);
  dlg.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t === dlg) { dlg!.close(); return; } // click on the backdrop
    const hit = t.closest<HTMLElement>('[data-dlg]');
    if (hit && handler) handler(hit, () => dlg!.close());
  });
  dlg.addEventListener('close', () => {
    handler = null;
    const key = returnKey;
    returnKey = undefined;
    // The page behind may have re-rendered; look the opener up again.
    if (key) document.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true });
  });
  return dlg;
}

export interface DialogOptions {
  title: string;
  /** Inner HTML. Buttons that should do something carry data-dlg="<name>"; data-dlg="cancel" just closes. */
  body: string;
  onPick: (name: string, close: () => void) => void;
  /** data-key of the element to refocus when the dialog closes. */
  returnFocusKey?: string;
}

export function openDialog(o: DialogOptions): void {
  const d = ensure();
  returnKey = o.returnFocusKey;
  handler = (el, close) => {
    const name = el.dataset.dlg!;
    if (name === 'cancel') close();
    else o.onPick(name, close);
  };
  d.setAttribute('aria-labelledby', 'dlg-title');
  d.innerHTML = `<h2 id="dlg-title" class="dlg-title">${o.title}</h2>${o.body}`;
  if (!d.open) d.showModal();
}

export function closeDialog(): void {
  if (dlg?.open) dlg.close();
}
