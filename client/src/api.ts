import type { ModulosDto, PartidaDto, SistemaInfoDto } from "@pyv/shared";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let msg = res.statusText || `Error ${res.status}`;
    try {
      const j = (await res.json()) as { error?: string; detalles?: string[] };
      if (j.error) msg = j.error;
      if (j.detalles?.length) msg += ` (${j.detalles.join("; ")})`;
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const get = <T,>(url: string) => request<T>("GET", url);
export const post = <T,>(url: string, body?: unknown) => request<T>("POST", url, body ?? {});
export const patch = <T,>(url: string, body: unknown) => request<T>("PATCH", url, body);
export const put = <T,>(url: string, body: unknown) => request<T>("PUT", url, body);
export const del = <T,>(url: string) => request<T>("DELETE", url);

/** Sube un archivo (imagen/PDF/audio según permisos) y devuelve el nombre guardado. */
export const upload = (file: File, url = "/api/archivos") => sendFile<{ archivo: string; kind: string }>(file, url);

async function sendFile<T>(file: File, url: string): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(url, { method: "POST", body: form, credentials: "same-origin" });
  if (!res.ok) {
    let msg = "No se pudo subir el archivo";
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* sin JSON */
    }
    throw new ApiError(res.status, msg);
  }
  return (await res.json()) as T;
}

export const fileUrl = (name: string | null | undefined) => (name ? `/archivos/${name}` : null);

// --- Panel local del anfitrión ---------------------------------------------------
export interface TunnelInfo {
  estado: "detenido" | "iniciando" | "activo" | "error";
  url: string | null;
  error: string | null;
}
export interface NetworkInfo {
  publicPort: number;
  lan: string[];
  tunnel: TunnelInfo;
}
export const admin = {
  ping: () => get<{ ok: boolean; publicPort: number }>("/admin-api/ping"),
  partidas: () => get<PartidaDto[]>("/admin-api/partidas"),
  sistemas: () => get<SistemaInfoDto[]>("/admin-api/sistemas"),
  crear: (b: { nombre: string; descripcion: string; anfitrionNombre: string; sistema?: string }) => post<PartidaDto>("/admin-api/partidas", b),
  patch: (id: string, b: Partial<Pick<PartidaDto, "nombre" | "descripcion" | "edicionLibreDefault" | "sistema">>) => patch<PartidaDto>(`/admin-api/partidas/${id}`, b),
  activar: (id: string) => post<PartidaDto>(`/admin-api/partidas/${id}/activar`),
  desactivar: (id: string) => post<PartidaDto>(`/admin-api/partidas/${id}/desactivar`),
  borrar: (id: string) => del<{ ok: true }>(`/admin-api/partidas/${id}`),
  imagen: (id: string, f: File) => upload(f, `/admin-api/partidas/${id}/imagen`),
  entrar: (id: string) => post<{ url: string }>(`/admin-api/partidas/${id}/entrar`),
  red: () => get<NetworkInfo>("/admin-api/red"),
  tunnelStart: () => post<TunnelInfo>("/admin-api/tunnel/start"),
  tunnelStop: () => post<TunnelInfo>("/admin-api/tunnel/stop"),
  modulos: () => get<ModulosDto>("/admin-api/modulos"),
  instalarModulo: (f: File) => sendFile<ModulosDto>(f, "/admin-api/modulos"),
  quitarModulo: (archivo: string) => del<ModulosDto>(`/admin-api/modulos/${encodeURIComponent(archivo)}`),
};
