// Moneo · contratos · dinero en JSON (ADR-004, RN-25, F3-04 §3.2)
// El dinero viaja como string decimal canónico. Nunca number, nunca float.
//   Entrada positiva (montos de movimientos):  "23500" | "23500.50"   (0 o 2 decimales, sin signo, > 0)
//   Entrada con signo (saldo inicial, saldo objetivo, celda de asignación): "-120000.00" | "0"
//   Salida (siempre): 2 decimales, signo "-" ASCII si es negativo: "12350.50", "-30.00", "0.00"
// El parser de la interfaz (RNF-IDI-03) convierte "23.500,5" o "23500.5" a este formato ANTES
// de enviar; la API no adivina formatos locales.
import { z } from "zod";

export type Cents = bigint & { readonly __brand: "Cents" };

/** 999.999.999,99 COP. Mismo número que los CHECK de la migración 20261109000000_amount_limits. */
export const MAX_AMOUNT_CENTS = 99_999_999_999n as Cents;

// Sin ceros a la izquierda; hasta 9 dígitos enteros (≤ 999.999.999); 0 o 2 decimales.
const UNSIGNED = /^(0|[1-9]\d{0,8})(\.\d{2})?$/;
const SIGNED = /^-?(0|[1-9]\d{0,8})(\.\d{2})?$/;

function toCents(s: string): bigint {
  const neg = s.startsWith("-");
  const body = neg ? s.slice(1) : s;
  // La regex ya garantizó la forma; los valores por defecto solo satisfacen noUncheckedIndexedAccess.
  const [int = "0", dec = "00"] = body.split(".");
  const v = BigInt(int) * 100n + BigInt(dec);
  return neg ? -v : v;
}

export function formatCents(c: bigint): string {
  const neg = c < 0n;
  const abs = neg ? -c : c;
  const int = abs / 100n;
  const dec = (abs % 100n).toString().padStart(2, "0");
  return `${neg ? "-" : ""}${int}.${dec}`;
}

/** Monto de un movimiento: > 0 y ≤ máximo. */
export const PositiveMoney = z
  .string()
  .regex(UNSIGNED, { message: "money_format" })
  .transform((s) => toCents(s))
  .refine((c) => c > 0n, { message: "money_not_positive" })
  .refine((c) => c <= MAX_AMOUNT_CENTS, { message: "money_too_large" })
  .transform((c) => c as Cents)
  .meta({
    type: "string",
    pattern: UNSIGNED.source,
    description: "COP, decimal string, > 0, ≤ 999999999.99",
  });

/** Saldo inicial, saldo objetivo y celda de asignación: con signo, |x| ≤ máximo. "-0" se rechaza. */
export const SignedMoney = z
  .string()
  .regex(SIGNED, { message: "money_format" })
  .refine((s) => !/^-0(\.00)?$/.test(s), { message: "money_format" })
  .transform((s) => toCents(s) as Cents)
  .meta({
    type: "string",
    pattern: SIGNED.source,
    description: "COP, signed decimal string, |x| ≤ 999999999.99",
  });

/** Salida: cualquier Cents (sumas incluidas, sin tope) → string canónico con 2 decimales. */
export const MoneyOut = z
  .custom<Cents>((v) => typeof v === "bigint")
  .transform((c) => formatCents(c))
  .meta({ type: "string", pattern: "^-?(0|[1-9]\\d*)\\.\\d{2}$" });
