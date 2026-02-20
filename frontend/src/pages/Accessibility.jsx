import React from 'react';
import usePageMeta from '@/hooks/usePageMeta';

export default function Accessibility() {
  usePageMeta('הצהרת נגישות');

  return (
    <section className="max-w-3xl mx-auto px-6 pt-28 pb-32" aria-labelledby="accessibility-title">
      <h1 id="accessibility-title" className="text-2xl font-bold mb-4">הצהרת נגישות</h1>
      <p className="mb-3">אתר Familia שואף לעמוד בדרישות תקן WCAG 2.1 ברמה AA ובהתאמה לציפיות הנגישות בישראל.</p>
      <h2 className="font-bold mt-4 mb-2">מה נבדק</h2>
      <ul className="list-disc pr-6 space-y-1">
        <li>ניווט מקלדת, סדר פוקוס ותפעול רכיבים אינטראקטיביים.</li>
        <li>תיוג טפסים, הודעות שגיאה והודעות דינמיות לקוראי מסך.</li>
        <li>מבנה סמנטי, היררכיית כותרות, דיאלוגים ותמיכה ב-RTL.</li>
      </ul>
      <h2 className="font-bold mt-4 mb-2">מגבלות ידועות</h2>
      <p>ייתכנו תכני מדיה שמקורם בהעלאות מנהל שלא עודכנו עדיין עם תיאורי alt מלאים. אנו ממשיכים לשפר באופן שוטף.</p>
      <h2 className="font-bold mt-4 mb-2">יצירת קשר בנושא נגישות</h2>
      <p>לפניות בנושא נגישות: <a className="underline" href="tel:+972523767851">052-3767851</a> או בדוא״ל <a className="underline" href="mailto:accessibility@familia.example">accessibility@familia.example</a>.</p>
      <p className="mt-4 text-sm text-gray-600">עדכון אחרון: 20/02/2026</p>
    </section>
  );
}
