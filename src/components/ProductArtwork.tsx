import React, { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { ProductArtworkKey } from '../types';

interface ProductArtworkProps {
  artworkKey?: ProductArtworkKey;
  customImageUrl?: string;
  alt: string;
  className?: string;
}

export const ProductArtwork: React.FC<ProductArtworkProps> = ({
  customImageUrl,
  alt,
  className = 'w-full h-56',
}) => {
  const [stage, setStage] = useState<'direct' | 'proxy' | 'failed'>('direct');

  useEffect(() => {
    setStage('direct');
  }, [customImageUrl]);

  const trimmedUrl = customImageUrl?.trim() || '';
  const isExternalHttp = /^https?:\/\//i.test(trimmedUrl);

  const activeSrc =
    stage === 'direct'
      ? trimmedUrl
      : stage === 'proxy' && isExternalHttp
      ? `/api/media/proxy?url=${encodeURIComponent(trimmedUrl)}`
      : '';

  if (activeSrc && stage !== 'failed') {
    return (
      <img
        src={activeSrc}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => {
          if (stage === 'direct' && isExternalHttp) {
            setStage('proxy');
          } else {
            setStage('failed');
          }
        }}
        className={`${className} object-contain object-center bg-white dark:bg-slate-900`}
      />
    );
  }

  return (
    <div
      role="img"
      aria-label={alt}
      className={`${className} flex flex-col items-center justify-center gap-2 overflow-hidden select-none bg-slate-100 dark:bg-slate-800/80 text-slate-400 dark:text-slate-500 px-4 text-center`}
    >
      <div className="w-11 h-11 rounded-xl bg-white/80 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-center">
        <ImageOff className="w-5 h-5" />
      </div>
      <span className="text-[11px] font-medium leading-tight">
        Sem foto oficial
      </span>
    </div>
  );
};
