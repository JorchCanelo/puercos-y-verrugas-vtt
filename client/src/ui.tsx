import { useEffect, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { useStore } from "./store";

export const cx = (...p: (string | false | null | undefined)[]) => p.filter(Boolean).join(" ");

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "subtle"; small?: boolean };
export function Button({ variant = "subtle", small, className, ...p }: BtnProps) {
  const styles = {
    primary: "bg-gold text-night hover:brightness-110 font-semibold",
    subtle: "bg-panel-2 border border-line hover:border-gold-dim",
    ghost: "hover:bg-panel-2",
    danger: "bg-danger/90 text-white hover:brightness-110",
  }[variant];
  return (
    <button
      type="button"
      {...p}
      className={cx("rounded-md transition disabled:opacity-40 disabled:cursor-not-allowed select-none", small ? "px-2 py-1 text-xs" : "px-3 py-2 text-sm", styles, className)}
    />
  );
}

const fieldCls = "w-full rounded-md border border-line bg-night/60 px-2.5 py-2 text-sm placeholder:text-muted/60 focus:border-gold-dim";
export function Input(p: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx(fieldCls, p.className)} />;
}
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx(fieldCls, "min-h-20", p.className)} />;
}
export function Select(p: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx(fieldCls, p.className)} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs uppercase tracking-wide text-muted">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted/80">{hint}</span>}
    </label>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line bg-panel/90 p-3 sm:p-4", className)}>
      {(title || actions) && (
        <header className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-base text-gold">{title}</h3>
          <div className="flex gap-2">{actions}</div>
        </header>
      )}
      {children}
    </section>
  );
}

/** Contador de puntos (suerte, experiencia): clic en el n-ésimo punto lo fija; clic en el último lleno baja uno. */
export function Pips({ value, max, onChange, label, color = "bg-gold" }: { value: number; max: number; onChange?: (n: number) => void; label: string; color?: string }) {
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label}>
      {Array.from({ length: max }, (_, i) => {
        const filled = i < value;
        return (
          <button
            key={i}
            type="button"
            disabled={!onChange}
            aria-label={`${label}: ${i + 1}`}
            aria-pressed={filled}
            onClick={() => onChange?.(value === i + 1 ? i : i + 1)}
            className={cx("h-6 w-6 rounded-full border transition", filled ? `${color} border-transparent` : "border-line bg-night/60", onChange && "hover:border-gold")}
          />
        );
      })}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border border-line bg-panel p-4 sm:rounded-2xl", wide ? "sm:max-w-3xl" : "sm:max-w-lg")}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg text-gold">{title}</h2>
          <Button variant="ghost" small onClick={onClose} aria-label="Cerrar">
            ✕
          </Button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Toasts() {
  const { toasts, dismissToast } = useStore();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-3 z-50 flex flex-col items-center gap-2 px-3" aria-live="polite">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={cx("pointer-events-auto max-w-md rounded-lg border px-3 py-2 text-left text-sm shadow-lg", t.kind === "error" ? "border-danger bg-danger/20" : "border-ok bg-ok/20")}
        >
          {t.text}
        </button>
      ))}
    </div>
  );
}

/** Botón que pide confirmación antes de ejecutar una acción destructiva. */
export function ConfirmButton({ children, onConfirm, message = "¿Seguro?", ...p }: BtnProps & { onConfirm: () => void; message?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 3000);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <Button {...p} variant={armed ? "danger" : p.variant} onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}>
      {armed ? message : children}
    </Button>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line p-4 text-center text-sm text-muted">{children}</p>;
}
