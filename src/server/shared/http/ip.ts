/**
 * IP del cliente para el límite por IP (DN-2: 20 intentos de login por IP en 15 min, F4-04c).
 *
 * Solo se confía en una cabecera que pone el proxy de Vercel y que el cliente no puede fijar:
 * `x-vercel-forwarded-for`. Vercel sobrescribe `x-forwarded-for` para evitar suplantación, pero esa
 * otra puede reescribirla un proxy delante de Vercel; la de Vercel no (documentación de Vercel,
 * «Request headers», consultada el 2026-11-19). F4-06 lo comprueba en staging con una cabecera falsa.
 *
 * Fuera de Vercel (local, CI) no hay proxy confiable: toda petición cuenta como la misma IP.
 * IPv6 se agrupa por /64: quien controla una red /64 cambia de dirección sin esfuerzo.
 */
import { isIPv4, isIPv6 } from "node:net";
import { config } from "../config";

export const IP_DESCONOCIDA = "desconocida";

/** Las 4 primeras palabras de 16 bits (/64) de una IPv6 ya válida, en forma completa. */
function prefijo64(ip: string): string {
  const [cabeza = "", cola = ""] = ip.split("::");
  const a = cabeza ? cabeza.split(":") : [];
  const b = cola ? cola.split(":") : [];
  // Una IPv6 con IPv4 al final (`::ffff:1.2.3.4`) ocupa dos palabras.
  const largo = (p: string[]) => p.reduce((n, x) => n + (x.includes(".") ? 2 : 1), 0);
  const palabras = ip.includes("::")
    ? [...a, ...Array<string>(8 - largo(a) - largo(b)).fill("0"), ...b]
    : a;
  return palabras
    .slice(0, 4)
    .map((p) => p.toLowerCase().replace(/^0+(?=.)/, ""))
    .join(":");
}

/** Normaliza una IP: IPv4 tal cual; IPv4 dentro de IPv6 (`::ffff:a.b.c.d`) como IPv4; IPv6 por /64. */
export function normalizarIp(ip: string | null | undefined): string {
  const v = ip?.trim() ?? "";
  if (isIPv4(v)) return v;
  if (isIPv6(v)) {
    const mapeada = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v)?.[1];
    if (mapeada && isIPv4(mapeada)) return mapeada;
    return `${prefijo64(v)}::/64`;
  }
  return IP_DESCONOCIDA;
}

/** IP del cliente lista para usar como clave del límite. `enVercel` se inyecta en las pruebas. */
export function ipCliente(peticion: Request, enVercel: boolean = config().enVercel): string {
  if (!enVercel) return IP_DESCONOCIDA;
  const valor = peticion.headers.get("x-vercel-forwarded-for");
  // Si llegara una lista, la primera es la del cliente.
  return normalizarIp(valor?.split(",")[0]);
}
