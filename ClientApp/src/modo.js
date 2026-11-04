// Modo de execução do front-end.
//
// - Normal (padrão): fala com a API em C# (servidor + SQL Server), com login.
// - Local ("mobile"): sem servidor e sem login. Os dados ficam no próprio aparelho (IndexedDB) e o app
//   funciona offline. É o modo do PWA e do APK Android. Ativado por `npm run build:mobile`
//   (que carrega o arquivo .env.mobile com VITE_MODO=local).
export const MODO_LOCAL = import.meta.env.VITE_MODO === 'local';

// Fixas, parcelas, cartões, metas e o painel existem nos dois modos (a API em C# implementa as mesmas regras).
export const TEM_FIXAS = true;
