import { useEffect } from 'react';

export default function usePageMeta(title) {
  useEffect(() => {
    if (title) {
      document.title = `${title} | Familia`;
    }
    document.documentElement.lang = 'he';
    document.documentElement.dir = 'rtl';
  }, [title]);
}
