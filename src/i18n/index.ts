import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';

export const locales = ['zh-CN', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'zh-CN';

let initialized = false;

export async function initI18n(locale: Locale = defaultLocale) {
  if (initialized) return;
  initialized = true;

  const zhCN = (await import('./locales/zh-CN.json')).default;
  const en = (await import('./locales/en.json')).default;

  await i18next.use(initReactI18next).init({
    lng: locale,
    fallbackLng: defaultLocale,
    resources: {
      'zh-CN': { translation: zhCN },
      en: { translation: en },
    },
    interpolation: {
      escapeValue: false,
    },
  });
}

export default initI18n;
