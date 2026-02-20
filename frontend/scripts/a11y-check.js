import fs from 'fs';
import path from 'path';

const findings = [];

const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf8');
if (!/<html[^>]*lang="he"[^>]*dir="rtl"/.test(indexHtml)) {
  findings.push({ severity: 'critical', message: 'Document root must include lang="he" and dir="rtl".' });
}

for (const file of ['src/components/VerificationModal.jsx', 'src/components/VideoGallery.jsx']) {
  const content = fs.readFileSync(path.resolve(file), 'utf8');
  if (!/role="dialog"/.test(content) || !/aria-modal="true"/.test(content)) {
    findings.push({ severity: 'serious', message: `${file} modal markup missing role=dialog/aria-modal.` });
  }
}

const layout = fs.readFileSync(path.resolve('src/pages/Layout.jsx'), 'utf8');
if (!/main-content/.test(layout)) {
  findings.push({ severity: 'serious', message: 'Layout missing main landmark wiring.' });
}

const blocking = findings.filter((f) => ['critical', 'serious'].includes(f.severity));
if (blocking.length) {
  console.error('Accessibility check failed with serious/critical findings:');
  blocking.forEach((f) => console.error(`- [${f.severity}] ${f.message}`));
  process.exit(1);
}

console.log('Accessibility check passed (0 serious/critical findings).');
