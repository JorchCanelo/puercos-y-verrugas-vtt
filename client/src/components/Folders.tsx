// Carpetas para organizar listas (NPCs, materiales). Una carpeta es solo un nombre guardado en cada elemento:
// existe mientras tenga algo dentro. Se muestran primero las carpetas (plegables) y luego lo que no tiene carpeta.
import { useState, type ReactNode } from "react";
import { Input } from "../ui";

const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

/** Nombres de carpeta distintos, en orden alfabético (para sugerirlos al elegir una). */
export function folderNames(items: { carpeta: string }[]): string[] {
  return [...new Set(items.map((i) => i.carpeta).filter(Boolean))].sort(collator.compare);
}

function readOpen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== "0";
  } catch {
    return true;
  }
}
function writeOpen(key: string, open: boolean) {
  try {
    if (open) localStorage.removeItem(key);
    else localStorage.setItem(key, "0");
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
}

/** `storageKey` identifica la lista para recordar (en este navegador) qué carpetas están plegadas. */
export function FolderGroups<T extends { id: string; carpeta: string }>({
  items,
  render,
  storageKey,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  storageKey: string;
}) {
  const names = folderNames(items);
  const loose = items.filter((i) => !i.carpeta);
  return (
    <div className="space-y-2">
      {names.map((name) => (
        <Folder key={name} name={name} storageKey={`pyv:carpeta:${storageKey}:${name}`}>
          {items.filter((i) => i.carpeta === name).map(render)}
        </Folder>
      ))}
      {loose.map(render)}
    </div>
  );
}

function Folder({ name, storageKey, children }: { name: string; storageKey: string; children: ReactNode[] }) {
  const [open, setOpen] = useState(() => readOpen(storageKey));
  const toggle = () => {
    setOpen(!open);
    writeOpen(storageKey, !open);
  };
  return (
    <div className="rounded-xl border border-line/70 bg-night/30">
      <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm" onClick={toggle} aria-expanded={open}>
        <span aria-hidden>{open ? "📂" : "📁"}</span>
        <span className="min-w-0 flex-1 truncate font-semibold">{name}</span>
        <span className="text-xs text-muted">{children.length}</span>
        <span className="text-muted" aria-hidden>{open ? "▾" : "▸"}</span>
      </button>
      {open && <div className="space-y-2 px-2 pb-2">{children}</div>}
    </div>
  );
}

/** Campo de carpeta con las existentes como sugerencias; vacío = sin carpeta. */
export function FolderInput({ value, onChange, options, id }: { value: string; onChange: (v: string) => void; options: string[]; id: string }) {
  return (
    <>
      <Input list={id} value={value} maxLength={60} placeholder="Sin carpeta" onChange={(e) => onChange(e.target.value)} />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
    </>
  );
}
