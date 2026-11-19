import sharp from 'sharp';

export interface StandardizedProductImage {
  buffer: Buffer;
  width: number;
  height: number;
  mimetype: 'image/jpeg';
  smallThumbBuffer: Buffer;
  thumbWidth: number;
  thumbHeight: number;
}

export interface StandardizeImageOptions {
  /** Final square canvas width & height in pixels (default 800 -> 800x800). */
  size?: number;
  /** Uniform white breathing margin ratio on each side (default 0.05 = 5% per side). */
  paddingRatio?: number;
  /** JPEG output quality 1..100 (default 88). */
  quality?: number;
  /** Small square JPEG thumbnail size for WhatsApp linkPreview fallback (default 192). */
  thumbSize?: number;
}

/**
 * Returns ordered image URL candidates preferring higher-resolution, uncropped
 * marketplace variants (e.g., Mercado Livre `-F.webp` / `-O.webp` instead of tiny `-P.webp`)
 * while always preserving the original URL as final fallback.
 */
export function getHighResImageCandidateUrls(imageUrl: string): string[] {
  const trimmed = String(imageUrl || '').trim();
  if (!trimmed) return [];
  if (!/^https?:\/\//i.test(trimmed)) return [trimmed];

  const candidates: string[] = [];
  const pushUnique = (u: string) => {
    if (u && !candidates.includes(u)) candidates.push(u);
  };

  // Mercado Livre CDN: D_NQ_NP_...-[PIVSMEO].(webp|jpg|jpeg)
  // `-P.webp` is ~250px low-res; `-F.webp` is ~1000-1200px full resolution; `-O.webp` is ~500px.
  const mlMatch = trimmed.match(
    /^(https?:\/\/[^/]*mlstatic\.com\/[^?#]+?)-([PIVSMEO])\.(webp|jpe?g)(\?.*)?$/i
  );
  if (mlMatch) {
    const [, prefix, variant, , query = ''] = mlMatch;
    if (variant.toUpperCase() !== 'F') {
      pushUnique(`${prefix}-F.webp${query}`);
      pushUnique(`${prefix}-O.webp${query}`);
      pushUnique(`${prefix}-O.jpg${query}`);
    }
    pushUnique(trimmed);
    return candidates;
  }

  // Amazon CDN small thumbnails: ._AC_SX300_.jpg / ._AC_US200_.jpg / ._SL320_.jpg
  if (/(?:media-amazon\.com|ssl-images-amazon\.com|images-na\.ssl-images-amazon\.com)/i.test(trimmed)) {
    const upgraded = trimmed.replace(
      /\._(?:AC_)?(?:SX|SY|SL|US|SS|UL|SR)\d+(?:,\d+)?(?:_QL\d+)?_\./i,
      '._AC_SL1000_.'
    );
    if (upgraded !== trimmed) {
      pushUnique(upgraded);
    }
    pushUnique(trimmed);
    return candidates;
  }

  // Shopee CDN `_tn` thumbnail suffix
  if (/(?:susercontent\.com|shopee\.com)/i.test(trimmed) && /_tn(?:\?.*)?$/i.test(trimmed)) {
    pushUnique(trimmed.replace(/_tn(\?.*)?$/i, '$1'));
    pushUnique(trimmed);
    return candidates;
  }

  pushUnique(trimmed);
  return candidates;
}

/**
 * Standardizes any product image (WebP, PNG, JPEG, AVIF, wide, tall, small, transparent)
 * into a uniform 1:1 square JPEG on a clean white studio background with `fit: 'contain'`
 * and uniform margins so WhatsApp/Telegram always render every offer at the exact same
 * dimensions without cropping any part of the product.
 */
export async function standardizeProductImageBuffer(
  inputBuffer: Buffer,
  options: StandardizeImageOptions = {}
): Promise<StandardizedProductImage> {
  if (!Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
    throw new Error('Buffer de imagem inválido ou vazio.');
  }

  const size = Math.max(256, Math.min(1600, Math.round(options.size ?? 800)));
  const paddingRatio = Math.max(0, Math.min(0.2, options.paddingRatio ?? 0.05));
  const quality = Math.max(50, Math.min(96, Math.round(options.quality ?? 88)));
  const thumbSize = Math.max(64, Math.min(320, Math.round(options.thumbSize ?? 192)));

  const pad = Math.round(size * paddingRatio);
  const innerSize = Math.max(64, size - pad * 2);
  const white = { r: 255, g: 255, b: 255, alpha: 1 };

  const buffer = await sharp(inputBuffer, { failOn: 'none' })
    .rotate()
    .flatten({ background: white })
    .resize({
      width: innerSize,
      height: innerSize,
      fit: 'contain',
      position: 'centre',
      background: white,
      withoutEnlargement: false,
      kernel: sharp.kernel.lanczos3,
    })
    .extend({
      top: pad,
      bottom: pad,
      left: pad,
      right: pad,
      background: white,
    })
    .jpeg({
      quality,
      mozjpeg: true,
      chromaSubsampling: '4:4:4',
    })
    .toBuffer();

  const smallThumbBuffer = await sharp(buffer)
    .resize({
      width: thumbSize,
      height: thumbSize,
      fit: 'fill',
    })
    .jpeg({
      quality: 72,
      mozjpeg: true,
    })
    .toBuffer();

  return {
    buffer,
    width: size,
    height: size,
    mimetype: 'image/jpeg',
    smallThumbBuffer,
    thumbWidth: thumbSize,
    thumbHeight: thumbSize,
  };
}
