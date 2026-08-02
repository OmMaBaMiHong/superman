import { useTranslation as useTranslationOriginal } from 'react-i18next';

export function useTranslation(namespace?: string) {
  return useTranslationOriginal(namespace ?? 'translation');
}
