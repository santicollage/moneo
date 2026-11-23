// F4-05a · Un Supabase Auth falso: un `fetch` que responde lo que diga la prueba y anota las llamadas.
import { PERFIL } from "./jwt";

export const URL_SUPABASE = "http://supa.test";
export const CONFIG_AUTH = {
  url: URL_SUPABASE,
  clavePublica: "sb_" + "publishable_" + "MARCADOR",
  cookiesSeguras: true,
};

export type Llamada = { url: URL; metodo: string; cabeceras: Headers; cuerpo: unknown };

export function gotrueFalso(responder: (l: Llamada) => Response | Promise<Response>) {
  const llamadas: Llamada[] = [];
  const fetchFalso: typeof fetch = async (entrada, init) => {
    const pedido = new Request(entrada, init);
    const texto = await pedido.text();
    const llamada: Llamada = {
      url: new URL(pedido.url),
      metodo: pedido.method,
      cabeceras: pedido.headers,
      cuerpo: texto ? (JSON.parse(texto) as unknown) : undefined,
    };
    llamadas.push(llamada);
    return responder(llamada);
  };
  return { fetch: fetchFalso, llamadas };
}

/** Respuesta de `POST /auth/v1/token?grant_type=refresh_token`. */
export function sesionNueva(tokenAcceso: string, tokenRefresco: string, ahoraS: number) {
  return Response.json({
    access_token: tokenAcceso,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: ahoraS + 3600,
    refresh_token: tokenRefresco,
    user: {
      id: PERFIL,
      aud: "authenticated",
      role: "authenticated",
      email: "ana@moneo.test",
      app_metadata: { provider: "email" },
      user_metadata: {},
      created_at: "2026-01-01T00:00:00Z",
    },
  });
}

export const errorGotrue = (estado: number, codigo: string) =>
  Response.json({ code: estado, error_code: codigo, msg: "MARCADOR" }, { status: estado });
