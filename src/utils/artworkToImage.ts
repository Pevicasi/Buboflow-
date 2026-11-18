import { ProductArtworkKey } from '../types';

const ARTWORK_SVG_BODY: Record<ProductArtworkKey, string> = {
  sneaker: `
    <ellipse cx="120" cy="142" rx="68" ry="9" fill="#CBD5E1" opacity="0.55" />
    <path d="M52 122 C52 104, 68 82, 86 72 L106 84 C122 92, 152 98, 182 106 C195 110, 196 126, 184 132 L62 132 C54 132, 52 128, 52 122 Z" fill="#0284C7" />
    <path d="M66 78 C72 68, 86 66, 96 74 L106 84 L82 95 C72 92, 64 85, 66 78 Z" fill="#0369A1" />
    <path d="M50 126 L188 126 C192 126, 194 135, 184 137 L56 137 C49 137, 47 130, 50 126 Z" fill="#F8FAFC" />
    <path d="M98 78 L112 72 M110 85 L124 79 M122 91 L136 85" stroke="#E0F2FE" stroke-width="4.5" stroke-linecap="round" />
    <path d="M84 108 C108 112, 134 108, 154 98" stroke="#38BDF8" stroke-width="6" stroke-linecap="round" fill="none" />
  `,
  flipflops: `
    <rect x="46" y="24" width="64" height="152" rx="32" fill="#1E293B" />
    <path d="M52 56 Q78 46 104 56" stroke="#94A3B8" stroke-width="3" fill="none" />
    <path d="M50 66 Q78 56 106 66" stroke="#64748B" stroke-width="2.5" fill="none" />
    <path d="M54 128 L78 68 L102 128" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <circle cx="78" cy="68" r="5" fill="#E2E8F0" />
    <rect x="61" y="144" width="34" height="11" rx="5.5" stroke="#CBD5E1" stroke-width="1.5" fill="none" />
    <rect x="130" y="24" width="64" height="152" rx="32" fill="#1E293B" />
    <text x="162" y="96" text-anchor="middle" fill="#E2E8F0" font-size="13" font-weight="700" font-family="sans-serif">SURF</text>
    <text x="162" y="112" text-anchor="middle" fill="#CBD5E1" font-size="11" font-weight="600" font-family="sans-serif">ALL DAY</text>
    <path d="M138 128 L162 68 L186 128" stroke="#F8FAFC" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none" />
    <circle cx="162" cy="68" r="5" fill="#E2E8F0" />
    <rect x="145" y="144" width="34" height="11" rx="5.5" stroke="#CBD5E1" stroke-width="1.5" fill="none" />
  `,
  shorts: `
    <ellipse cx="120" cy="162" rx="56" ry="8" fill="#CBD5E1" opacity="0.5" />
    <path d="M68 42 L172 42 L184 136 L130 142 L120 108 L110 142 L56 136 Z" fill="#334155" />
    <rect x="68" y="34" width="104" height="18" rx="4" fill="#1E293B" />
    <path d="M84 62 C84 96, 114 102, 120 84 C126 102, 156 96, 156 62" stroke="#475569" stroke-width="3.5" fill="none" />
    <path d="M120 52 L120 106" stroke="#1E293B" stroke-width="3" />
  `,
  mug: `
    <defs>
      <linearGradient id="mugGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#9333EA" />
        <stop offset="50%" stop-color="#EC4899" />
        <stop offset="100%" stop-color="#F59E0B" />
      </linearGradient>
    </defs>
    <ellipse cx="115" cy="156" rx="58" ry="9" fill="#CBD5E1" opacity="0.5" />
    <path d="M154 68 C182 68, 184 126, 154 126" stroke="#1E293B" stroke-width="12" fill="none" stroke-linecap="round" />
    <rect x="64" y="46" width="94" height="102" rx="12" fill="url(#mugGrad)" />
    <ellipse cx="111" cy="48" rx="47" ry="8" fill="#1E293B" />
    <rect x="76" y="118" width="70" height="18" rx="4" fill="#0F172A" opacity="0.85" />
    <text x="111" y="131" text-anchor="middle" fill="#F8FAFC" font-size="10" font-weight="700" font-family="sans-serif">SEU NOME</text>
    <text x="111" y="92" text-anchor="middle" fill="#FFFFFF" font-size="18" font-weight="800" font-family="sans-serif">VI</text>
  `,
  cap: `
    <ellipse cx="120" cy="144" rx="72" ry="9" fill="#CBD5E1" opacity="0.5" />
    <path d="M66 108 C66 60, 174 60, 174 108 Z" fill="#0284C7" />
    <path d="M120 60 C138 68, 148 86, 150 108 L90 108 C92 86, 102 68, 120 60 Z" fill="#4F46E5" />
    <circle cx="120" cy="58" r="5" fill="#1E1B4B" />
    <path d="M44 122 C66 104, 122 104, 158 112 C140 132, 72 136, 44 122 Z" fill="#0369A1" />
    <circle cx="122" cy="88" r="13" fill="#14B8A6" />
    <text x="122" y="92" text-anchor="middle" fill="#0F172A" font-size="10" font-weight="800" font-family="sans-serif">90s</text>
  `,
  earbuds: `
    <ellipse cx="120" cy="150" rx="56" ry="8" fill="#CBD5E1" opacity="0.5" />
    <rect x="70" y="68" width="100" height="74" rx="28" fill="#1E293B" />
    <path d="M70 98 L170 98" stroke="#334155" stroke-width="2.5" />
    <circle cx="120" cy="116" r="4" fill="#10B981" />
    <rect x="88" y="38" width="24" height="38" rx="12" fill="#0F172A" />
    <circle cx="100" cy="48" r="7" fill="#38BDF8" opacity="0.85" />
    <rect x="128" y="38" width="24" height="38" rx="12" fill="#0F172A" />
    <circle cx="140" cy="48" r="7" fill="#38BDF8" opacity="0.85" />
  `,
  speaker: `
    <ellipse cx="120" cy="148" rx="54" ry="8" fill="#CBD5E1" opacity="0.5" />
    <circle cx="120" cy="96" r="48" fill="#334155" />
    <ellipse cx="120" cy="82" rx="42" ry="26" fill="#1E293B" />
    <path d="M84 128 Q120 144 156 128" stroke="#38BDF8" stroke-width="5" stroke-linecap="round" fill="none" />
  `,
  airfryer: `
    <ellipse cx="120" cy="160" rx="54" ry="8" fill="#CBD5E1" opacity="0.5" />
    <rect x="74" y="34" width="92" height="120" rx="24" fill="#0F172A" />
    <rect x="82" y="92" width="76" height="54" rx="12" fill="#1E293B" />
    <rect x="114" y="98" width="12" height="38" rx="6" fill="#94A3B8" />
    <circle cx="120" cy="62" r="14" fill="#1E293B" stroke="#10B981" stroke-width="2.5" />
    <text x="120" y="66" text-anchor="middle" fill="#10B981" font-size="9" font-weight="700" font-family="sans-serif">200°</text>
  `,
};

export async function renderArtworkFallbackDataUrl(
  artworkKey: ProductArtworkKey = 'sneaker'
): Promise<string> {
  if (typeof document === 'undefined') return '';
  const body = ARTWORK_SVG_BODY[artworkKey] || ARTWORK_SVG_BODY.sneaker;
  const viewBox = artworkKey === 'flipflops' ? '0 0 240 200' : '0 0 240 190';
  const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="480" viewBox="${viewBox}">
    <rect width="240" height="200" fill="#F8FAFC"/>
    ${body}
  </svg>`;

  try {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    const dataUrl = await new Promise<string>((resolve) => {
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 600;
          canvas.height = 480;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve('');
            return;
          }
          ctx.fillStyle = '#F8FAFC';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/png'));
        } catch {
          resolve('');
        } finally {
          URL.revokeObjectURL(url);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        resolve('');
      };
      img.src = url;
    });
    return dataUrl;
  } catch {
    return '';
  }
}
