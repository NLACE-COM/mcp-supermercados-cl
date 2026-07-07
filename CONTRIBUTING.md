# Cómo contribuir

Gracias por tu interés en mejorar **mcp-supermercados-cl**. Este proyecto crece
con la comunidad — desde arreglar el parser de una cadena que cambió su API
hasta agregar una cadena nueva.

## Antes de empezar

- **Node.js ≥ 20**.
- `npm install && npm run build && npm test` debe pasar en limpio.
- Abre un issue antes de un cambio grande, para alinear el enfoque.

## Flujo de trabajo

1. Haz fork y crea una rama descriptiva: `git checkout -b fix/unimarc-precio`.
2. Haz tu cambio con un test que lo cubra.
3. `npm test` (contrato, sin red) debe quedar verde.
4. Si tocaste un adaptador, corre `npm run test:live` para verificar contra el
   sitio real (requiere red; Unimarc/Tottus/Lider requieren IP residencial).
5. Abre un PR explicando **qué** cambió y **cómo lo verificaste**.

## Principios de diseño (no romper)

- **El servidor nunca ve credenciales.** El precio socio, los frecuentes y el
  carro se obtienen desde el navegador logueado del usuario; el MCP solo
  normaliza. No agregues login ni almacenamiento de tokens en el servidor.
- **Un adaptador por cadena, aislado.** Un cambio de sitio debe romper un solo
  adaptador, no todo. La lógica compartida vive en `src/core/`.
- **Esquema normalizado.** Todo producto se mapea a `Product`
  (`src/core/types.ts`): precio normal y socio separados, precio por unidad
  siempre en base canónica (por kg/lt/un), bundles estructurados.
- **Ritmo humano.** Todo HTTP pasa por `src/http/client.ts` (1 req/s por host,
  reintentos, user-agent realista). No hagas `fetch` directo en un adaptador.

## Cómo agregar o arreglar un adaptador

1. **Captura el endpoint real** navegando el sitio con tu sesión (DevTools →
   Network). No adivines la forma del payload: grábala.
2. Guarda una **fixture** real en `tests/fixtures/`, anotando la fecha y el
   endpoint en un comentario.
3. Implementa el adaptador contra la interfaz `StoreAdapter`
   (`src/adapters/base.ts`); mapea a `Product` con los helpers de
   `src/core/normalize.js` (`parseClpString`, `parseUnitPriceString`,
   `parseBundle`, `normalizeUnit`).
4. Escribe un **test de contrato** que use la fixture (sin red) y un smoke
   `*.live.test.ts` (opt-in con `LIVE=1`).
5. Registra el adaptador en `src/core/registry.ts` y amplía los enums de las
   tools que lo expongan.

## Cuando una cadena cambia su API

`npm run test:live` es el detector: si una cadena cambió su formato, el smoke
falla. Regraba la fixture afectada, ajusta el parser y sube el PR con la fecha
de recaptura.

## Estilo

- TypeScript estricto. Comentarios y textos de cara al usuario en español;
  identificadores en inglés.
- Comenta el *porqué* (una constraint, un endpoint verificado), no el *qué*.

## Reporte de bugs

Abre un issue con: cadena afectada, tool, input usado, salida esperada vs real,
y (si aplica) el fragmento de respuesta cruda del sitio.
