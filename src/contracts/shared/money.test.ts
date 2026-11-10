import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { PositiveMoney, SignedMoney, MoneyOut, MAX_AMOUNT_CENTS, formatCents } from "./money";

const ok = (s: unknown) => PositiveMoney.safeParse(s).success;
const sok = (s: unknown) => SignedMoney.safeParse(s).success;

describe("PositiveMoney (entrada de movimientos)", () => {
  it("acepta 0 o 2 decimales", () => {
    expect(PositiveMoney.parse("23500")).toBe(2_350_000n);
    expect(PositiveMoney.parse("23500.50")).toBe(2_350_050n);
    expect(PositiveMoney.parse("0.01")).toBe(1n);
    expect(PositiveMoney.parse("999999999.99")).toBe(MAX_AMOUNT_CENTS);
  });
  it.each([
    "0",
    "0.00",
    "1000000000",
    "1000000000.00",
    "23500.5",
    "23.500",
    "23,500",
    "023500",
    "-5",
    "+5",
    " 5",
    "5 ",
    "1e3",
    "0x10",
    "",
    "NaN",
    "Infinity",
    "5.",
    ".5",
    "5.000",
  ])("rechaza %s", (s) => expect(ok(s)).toBe(false));
  it("rechaza números JSON (nunca float)", () => {
    expect(ok(23500)).toBe(false);
    expect(ok(0.1)).toBe(false);
  });
});

describe("SignedMoney (saldo inicial, saldo objetivo, celda)", () => {
  it("acepta negativos y cero", () => {
    expect(SignedMoney.parse("-120000")).toBe(-12_000_000n);
    expect(SignedMoney.parse("0")).toBe(0n);
    expect(SignedMoney.parse("-999999999.99")).toBe(-MAX_AMOUNT_CENTS);
  });
  it.each(["-0", "-0.00", "--5", "-1000000000", "−5" /* U+2212 */])("rechaza %s", (s) =>
    expect(sok(s)).toBe(false),
  );
});

describe("propiedades", () => {
  const cents = fc.bigInt({ min: -MAX_AMOUNT_CENTS, max: MAX_AMOUNT_CENTS });
  it("ida y vuelta centavos → string → centavos sin pérdida", () => {
    fc.assert(fc.property(cents, (c) => SignedMoney.parse(formatCents(c)) === c));
  });
  it("positivos válidos pasan PositiveMoney y salen con 2 decimales", () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 1n, max: MAX_AMOUNT_CENTS }), (c) => {
        const s = MoneyOut.parse(c);
        return /\.\d{2}$/.test(s) && PositiveMoney.parse(s) === c;
      }),
    );
  });
  it("todo lo que pasa PositiveMoney está en (0, MAX]", () => {
    fc.assert(
      fc.property(fc.stringMatching(/^-?\d{1,11}(\.\d{1,3})?$/), (s) => {
        const r = PositiveMoney.safeParse(s);
        return !r.success || (r.data > 0n && r.data <= MAX_AMOUNT_CENTS);
      }),
    );
  });
  it("la salida no tiene tope (sumas)", () => {
    expect(MoneyOut.parse(1_800_000_000_000_000n)).toBe("18000000000000.00");
    expect(MoneyOut.parse(-5n)).toBe("-0.05");
  });
});
