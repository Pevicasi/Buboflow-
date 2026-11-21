import React from 'react';
import { Users, Video, Phone, Plus, Paperclip, Camera, Mic, CheckCheck } from 'lucide-react';
import { ProductArtworkKey } from '../types';
import { ProductArtwork } from './ProductArtwork';
import {
  buildWhatsAppLinkPreviewMeta,
  getLinkPreviewStoreTitle,
} from '../utils/affiliateUrlRules';

interface WhatsAppMockupProps {
  groupName?: string;
  participantsSubtitle?: string;
  message: string;
  artworkKey?: ProductArtworkKey;
  customImageUrl?: string;
  showMedia?: boolean;
  enableLinkPreview?: boolean;
  includeLinkPreviewDetails?: boolean;
  previewDomain?: string;
  time?: string;
}

function renderFormattedWhatsAppLine(line: string, lineIdx: number) {
  if (!line.trim()) {
    return <div key={lineIdx} className="h-3" />;
  }

  // Split URLs first so links look authentic
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const segments = line.split(urlRegex);

  return (
    <div key={lineIdx} className="leading-[1.38] break-words">
      {segments.map((seg, i) => {
        if (/^https?:\/\//.test(seg)) {
          return (
            <span key={i} className="text-[#027eb5] underline break-all">
              {seg}
            </span>
          );
        }

        // Parse simple WhatsApp inline tokens: *bold*, ~strike~, _italic_, `code`
        const tokenRegex = /(\*[^*]+\*|~[^~]+~|_[^_]+_|`[^`]+`)/g;
        const parts = seg.split(tokenRegex);

        return (
          <React.Fragment key={i}>
            {parts.map((part, j) => {
              if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
                return (
                  <strong key={j} className="font-semibold text-slate-900">
                    {part.slice(1, -1)}
                  </strong>
                );
              }
              if (part.startsWith('~') && part.endsWith('~') && part.length > 2) {
                return (
                  <span key={j} className="line-through text-slate-500">
                    {part.slice(1, -1)}
                  </span>
                );
              }
              if (part.startsWith('_') && part.endsWith('_') && part.length > 2) {
                return (
                  <em key={j} className="italic">
                    {part.slice(1, -1)}
                  </em>
                );
              }
              if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
                return (
                  <code
                    key={j}
                    className="font-mono text-[12px] bg-black/5 px-1 py-0.5 rounded"
                  >
                    {part.slice(1, -1)}
                  </code>
                );
              }
              return <span key={j}>{part}</span>;
            })}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export const WhatsAppMockup: React.FC<WhatsAppMockupProps> = ({
  groupName = 'Grupo de Ofertas',
  participantsSubtitle = 'Participantes do grupo',
  message,
  artworkKey,
  customImageUrl,
  showMedia = false,
  enableLinkPreview = false,
  includeLinkPreviewDetails = false,
  previewDomain = 's.shopee.com.br',
  time = '22:53',
}) => {
  const displayText = message.trim() || 'Sua mensagem aparecerá aqui...';
  const lines = displayText.split('\n');
  const previewMeta =
    enableLinkPreview && includeLinkPreviewDetails
      ? buildWhatsAppLinkPreviewMeta(displayText)
      : null;

  return (
    <div className="mx-auto w-full max-w-[330px] rounded-[36px] bg-[#18222D] p-3 shadow-md select-none">
      {/* Top Notch */}
      <div className="mx-auto mb-1.5 h-3.5 w-28 rounded-b-xl bg-[#18222D]" />

      {/* Screen */}
      <div className="overflow-hidden rounded-[26px] bg-[#EFEAE2] flex flex-col min-h-[450px]">
        {/* WhatsApp Top Bar */}
        <div className="flex items-center justify-between bg-[#F7F8FA] px-3 py-2.5 border-b border-slate-200">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-slate-600 text-sm font-medium">&lsaquo;</span>
            <div className="h-8 w-8 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center shrink-0">
              <Users className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] font-semibold text-slate-900 truncate">
                {groupName}
              </div>
              <div className="text-[10px] text-slate-500 truncate">
                {participantsSubtitle}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2.5 text-slate-600 shrink-0 pl-1">
            <Video className="w-4 h-4" />
            <Phone className="w-3.5 h-3.5" />
          </div>
        </div>

        {/* Chat Wallpaper Body */}
        <div className="flex-1 p-3 flex flex-col justify-start">
          <div className="ml-auto w-[92%] rounded-xl rounded-tr-xs bg-[#D9FDD3] p-2 shadow-xs text-[12.5px] text-slate-800">
            {(showMedia || artworkKey || customImageUrl) && (
              <div className="mb-2 overflow-hidden rounded-lg bg-white">
                <ProductArtwork
                  artworkKey={artworkKey || 'sneaker'}
                  customImageUrl={customImageUrl}
                  alt="Imagem da oferta"
                  className="w-full h-48 p-1.5"
                />
                {enableLinkPreview && (
                  <div className="bg-[#CFE9C8] px-2.5 py-1.5 space-y-0.5">
                    {previewMeta ? (
                      <>
                        <div className="text-[11.5px] font-semibold text-slate-900 line-clamp-2 leading-tight">
                          {previewMeta.title}
                        </div>
                        <div className="text-[10.5px] text-slate-600 truncate">
                          {previewMeta.description}
                        </div>
                      </>
                    ) : (
                      <div className="text-[11.5px] font-semibold text-slate-900 truncate leading-tight">
                        {getLinkPreviewStoreTitle(previewDomain)}
                      </div>
                    )}
                    <div className="text-[11px] text-slate-600 font-mono truncate">
                      {previewDomain}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="px-1 space-y-0.5">
              {lines.map((line, idx) => renderFormattedWhatsAppLine(line, idx))}
            </div>

            <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-500 tabular-nums">
              <span>{time}</span>
              <CheckCheck className="w-3.5 h-3.5 text-[#53bdeb]" />
            </div>
          </div>
        </div>

        {/* Bottom Input Bar */}
        <div className="bg-[#F0F2F5] px-2.5 py-2 flex items-center gap-2 border-t border-slate-200/70">
          <Plus className="w-4 h-4 text-slate-500 shrink-0" />
          <div className="flex-1 bg-white rounded-full px-3 py-1.5 flex items-center justify-between text-[11.5px] text-slate-400">
            <span>Mensagem</span>
            <Paperclip className="w-3.5 h-3.5 text-slate-400" />
          </div>
          <Camera className="w-4 h-4 text-slate-500 shrink-0" />
          <Mic className="w-4 h-4 text-slate-500 shrink-0" />
        </div>
      </div>
    </div>
  );
};
