// Next llama a register() una vez al arrancar el servidor (no en `next build`).
// RNF-SEG-11: sin configuración válida, el servidor no arranca. El error nombra la variable, no el valor.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { config } = await import("./server/shared/config");
  const { logger } = await import("./server/shared/log");
  try {
    config();
  } catch (err) {
    logger.error("config_invalid", { errorCode: "ErrorConfig" });
    throw err;
  }
}
