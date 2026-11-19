import React, { useState } from 'react';
import {
  ArrowLeft,
  Lightbulb,
  Plus,
  Pencil,
  Trash2,
  X,
  Copy,
  Save,
  Eye,
  Star,
  ExternalLink,
  Upload,
  CheckCircle2,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import {
  Marketplace,
  MessageTemplate,
  Product,
  TemplateCondition,
} from '../types';
import {
  DEFAULT_TEMPLATE_CONDITIONS,
  MARKETPLACES,
  TEMPLATE_PRESETS,
} from '../data/initialData';
import { WhatsAppMockup } from '../components/WhatsAppMockup';
import { TemplateBlockEditor } from '../components/TemplateBlockEditor';
import {
  getDemoProductForPlatform,
  getPreviewDomain,
  renderProductMessage,
} from '../utils/templateEngine';

function getMarketplaceBadgeColor(platform: Marketplace): string {
  switch (platform) {
    case 'Amazon':
      return 'bg-[#F59E0B] text-slate-900';
    case 'Netshoes':
      return 'bg-[#7E22CE] text-white';
    case 'Magalu':
      return 'bg-[#2563EB] text-white';
    case 'AliExpress':
      return 'bg-[#EF4444] text-white';
    case 'Mercado Livre':
      return 'bg-[#FACC15] text-slate-900';
    case 'Shopee':
      return 'bg-[#EA580C] text-white';
  }
}

/* ============================================================================
 * 1. TEMPLATES DE MENSAGEM VIEW (Telas 77–87)
 * ========================================================================== */
export const TemplatesConfigView: React.FC = () => {
  const { templates, setTemplates, products, integrations, setRoute, notify } = useApp();

  const [presetsOpen, setPresetsOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState(TEMPLATE_PRESETS[0].id);
  const [presetPlatform, setPresetPlatform] = useState<Marketplace>('Mercado Livre');

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tplName, setTplName] = useState('');
  const [tplPlatform, setTplPlatform] = useState<Marketplace>('Shopee');
  const [tplBody, setTplBody] = useState('');
  const [tplCtaStyle, setTplCtaStyle] = useState<MessageTemplate['ctaStyle']>('Padrão');
  const [tplLinkPreview, setTplLinkPreview] = useState(true);
  const [tplConditions, setTplConditions] = useState<TemplateCondition[]>([]);

  const openNewTemplate = () => {
    setEditingId(null);
    setTplName('');
    setTplPlatform('Shopee');
    setTplBody(
      '💥 [[cond:cond-1]]\n\n[[cond:cond-2]]\n*💸 Por: {{preco_desconto}} 🔥*\n[[cond:cond-3]]\n\n🔗 Compre aqui: {{link}}\n\n{{cupom}}\n\n🎟️ Resgate Cupons:\nhttps://s.shopee.com.br/8AXZEODUrk\n\n⚠️ Promoção sujeita a alteração a qualquer momento.'
    );
    setTplCtaStyle('Padrão');
    setTplLinkPreview(true);
    setTplConditions(DEFAULT_TEMPLATE_CONDITIONS.map((c) => ({ ...c })));
    setEditorOpen(true);
  };

  const openEditTemplate = (tpl: MessageTemplate) => {
    setEditingId(tpl.id);
    setTplName(tpl.name);
    setTplPlatform(tpl.platform);
    setTplBody(tpl.body);
    setTplCtaStyle(tpl.ctaStyle);
    setTplLinkPreview(tpl.enableLinkPreview);
    setTplConditions(tpl.conditions.map((c) => ({ ...c })));
    setEditorOpen(true);
  };

  const handleActivateTemplate = (tpl: MessageTemplate) => {
    setTemplates((prev) => [tpl, ...prev.filter((t) => t.id !== tpl.id)]);
    notify('Template ativado!', `${tpl.name} agora é o padrão para ${tpl.platform}.`);
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = tplName.trim() || `${tplPlatform} Template Personalizado`;
    const record: MessageTemplate = {
      id: editingId || `tpl-${Date.now()}`,
      name: finalName,
      platform: tplPlatform,
      body: tplBody,
      ctaStyle: tplCtaStyle,
      enableLinkPreview: tplLinkPreview,
      conditions: tplConditions,
    };

    // Place saved/created template at the top so getTemplateForPlatform immediately uses it
    setTemplates((prev) => [record, ...prev.filter((t) => t.id !== record.id)]);
    if (editingId) {
      notify('Template atualizado e ativo!', `${finalName} (${tplPlatform})`);
    } else {
      notify('Novo template salvo e ativo!', `${finalName} (${tplPlatform})`);
    }
    setEditorOpen(false);
  };

  const handleApplyPreset = () => {
    const preset = TEMPLATE_PRESETS.find((p) => p.id === selectedPresetId);
    if (!preset) return;
    setPresetsOpen(false);
    setEditingId(null);
    setTplName(`${presetPlatform} — ${preset.title}`);
    setTplPlatform(presetPlatform);
    setTplBody(preset.body);
    setTplCtaStyle('Padrão');
    setTplLinkPreview(true);
    setTplConditions((preset.conditions || DEFAULT_TEMPLATE_CONDITIONS).map((c) => ({ ...c })));
    setEditorOpen(true);
  };

  const draftTemplate: MessageTemplate = {
    id: 'draft',
    name: tplName || 'Preview',
    platform: tplPlatform,
    body: tplBody,
    ctaStyle: tplCtaStyle,
    enableLinkPreview: tplLinkPreview,
    conditions: tplConditions,
  };

  const realSampleForEditor: Product | undefined =
    products.find((p) => p.platform === tplPlatform && p.customImageUrl && p.discountPercent > 0) ||
    products.find((p) => p.platform === tplPlatform && p.customImageUrl) ||
    products.find((p) => p.platform === tplPlatform);
  const editorDemoProduct = getDemoProductForPlatform(tplPlatform, realSampleForEditor);

  const previewRendered = renderProductMessage(
    editorDemoProduct,
    draftTemplate,
    integrations
  );

  const realSampleForPreset: Product | undefined =
    products.find((p) => p.platform === presetPlatform && p.customImageUrl && p.discountPercent > 0) ||
    products.find((p) => p.platform === presetPlatform && p.customImageUrl) ||
    products.find((p) => p.platform === presetPlatform);
  const presetDemoProduct = getDemoProductForPlatform(presetPlatform, realSampleForPreset);

  const selectedPreset =
    TEMPLATE_PRESETS.find((p) => p.id === selectedPresetId) || TEMPLATE_PRESETS[0];
  const presetPreviewRendered = renderProductMessage(
    presetDemoProduct,
    {
      id: 'preset-preview',
      name: selectedPreset.title,
      platform: presetPlatform,
      body: selectedPreset.body,
      ctaStyle: 'Padrão',
      enableLinkPreview: true,
      conditions: selectedPreset.conditions || DEFAULT_TEMPLATE_CONDITIONS,
    },
    integrations
  );

  return (
    <div className="space-y-5">
      {/* Header with Back Arrow */}
      <div className="flex items-start gap-3">
        <button
          type="button"
          onClick={() => setRoute('configuracoes')}
          className="mt-1 p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Templates de Mensagem
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            Defina como as ofertas chegam nos seus grupos de WhatsApp.
          </p>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        <button
          type="button"
          onClick={() => setPresetsOpen(true)}
          className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm font-medium text-slate-700 dark:text-slate-200 flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800"
        >
          <Lightbulb className="w-4 h-4 text-amber-500" />
          <span>Modelos</span>
        </button>

        <button
          type="button"
          onClick={openNewTemplate}
          className="px-4 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          <span>Novo Template</span>
        </button>
      </div>

      {/* Templates Table (Tela 77) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800 text-xs font-semibold text-slate-500">
                <th className="py-3.5 px-4">Nome</th>
                <th className="py-3.5 px-4">Em uso em</th>
                <th className="py-3.5 px-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
              {templates.map((tpl) => {
                const isActiveForPlatform =
                  templates.find((t) => t.platform === tpl.platform)?.id === tpl.id;
                return (
                  <tr
                    key={tpl.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-white">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{tpl.name}</span>
                        {isActiveForPlatform && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            <span>Ativo</span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold font-mono ${getMarketplaceBadgeColor(
                          tpl.platform
                        )}`}
                      >
                        {tpl.platform}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1.5">
                        {!isActiveForPlatform && (
                          <button
                            type="button"
                            onClick={() => handleActivateTemplate(tpl)}
                            className="px-2.5 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
                          >
                            Ativar
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => openEditTemplate(tpl)}
                          title="Editar template"
                          className="p-2 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                        >
                          <Pencil className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (templates.length <= 1) {
                              notify(
                                'Mantenha ao menos 1 template',
                                undefined,
                                'error'
                              );
                              return;
                            }
                            setTemplates((prev) => prev.filter((t) => t.id !== tpl.id));
                            notify('Template removido', tpl.name, 'info');
                          }}
                          title="Excluir template"
                          className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-3 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs text-slate-500 tabular-nums">
          <span>{templates.length} Resultado(s)</span>
          <span>Página 1 de 1</span>
        </div>
      </div>

      {/* Modal: Modelos de Template (Telas 83–84) */}
      {presetsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-3xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-2xl my-auto">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                  Modelos de template
                </h3>
                <p className="text-xs sm:text-sm text-slate-500">
                  Escolha um modelo para ver como a mensagem chega no WhatsApp.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPresetsOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <label className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                Aplicar para a plataforma:
              </label>
              <select
                value={presetPlatform}
                onChange={(e) => setPresetPlatform(e.target.value as Marketplace)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold"
              >
                {MARKETPLACES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-start">
              <div className="space-y-2.5">
                {TEMPLATE_PRESETS.map((preset) => {
                  const selected = preset.id === selectedPresetId;
                  return (
                    <button
                      key={preset.id}
                      type="button"
                      onClick={() => setSelectedPresetId(preset.id)}
                      className={`w-full text-left rounded-xl p-4 border transition-colors ${
                        selected
                          ? 'border-[#15803D] bg-emerald-50/50 dark:bg-emerald-950/30'
                          : 'border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-bold text-sm text-slate-900 dark:text-white">
                          {preset.title}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {preset.tags.join(' · ')}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {preset.description}
                      </p>
                    </button>
                  );
                })}
              </div>

              <div>
                <WhatsAppMockup
                  message={presetPreviewRendered}
                  artworkKey={presetDemoProduct.artworkKey}
                  customImageUrl={presetDemoProduct.customImageUrl}
                  showMedia
                  enableLinkPreview
                  previewDomain={getPreviewDomain(presetPlatform)}
                  time="23:03"
                />
              </div>
            </div>

            <div className="mt-5 pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPresetsOpen(false)}
                className="px-4 py-2 rounded-xl text-sm text-slate-600 dark:text-slate-300"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={handleApplyPreset}
                className="px-4 py-2 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                Usar este modelo
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Editar / Novo Template (Telas 78–82 & 85–87) */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <form
            onSubmit={handleSaveTemplate}
            className="w-full max-w-4xl rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-5 sm:p-6 shadow-2xl my-auto max-h-[92vh] overflow-y-auto space-y-5"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-lg text-slate-900 dark:text-white">
                {editingId ? 'Editar Template' : 'Novo Template'}
              </h3>
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Editor Column */}
              <div className="lg:col-span-7 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      Nome do Template
                    </label>
                    <input
                      type="text"
                      required
                      value={tplName}
                      onChange={(e) => setTplName(e.target.value)}
                      placeholder="Ex: Shopee Template Padrão"
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1">
                      Plataforma Vinculada
                    </label>
                    <select
                      value={tplPlatform}
                      onChange={(e) => setTplPlatform(e.target.value as Marketplace)}
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
                    >
                      {MARKETPLACES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Editor unificado estilo BuboFlow: Variáveis, Conteúdo Dinâmico, Condicional e Blocos DENTRO do Conteúdo do Template */}
                <TemplateBlockEditor
                  body={tplBody}
                  conditions={tplConditions}
                  onChange={(nextBody, nextConditions) => {
                    setTplBody(nextBody);
                    setTplConditions(nextConditions);
                  }}
                />

                {/* Estilo do CTA & Preview de Link */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 items-center">
                  <div className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-center justify-between">
                    <span className="text-sm font-medium">Estilo do CTA</span>
                    <select
                      value={tplCtaStyle}
                      onChange={(e) =>
                        setTplCtaStyle(e.target.value as MessageTemplate['ctaStyle'])
                      }
                      className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 text-xs"
                    >
                      <option value="Padrão">Padrão</option>
                      <option value="Urgência">Urgência</option>
                      <option value="Direto">Direto</option>
                      <option value="Descontraído">Descontraído</option>
                    </select>
                  </div>

                  <label className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex items-start gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={tplLinkPreview}
                      onChange={(e) => setTplLinkPreview(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded text-[#15803D]"
                    />
                    <div className="text-xs">
                      <div className="font-semibold text-slate-900 dark:text-white">
                        Habilitar preview de link
                      </div>
                      <div className="text-slate-500 mt-0.5">
                        Envia com preview leve evitando encher a galeria.
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Right Live Mockup Column */}
              <div className="lg:col-span-5">
                <WhatsAppMockup
                  message={previewRendered}
                  artworkKey={editorDemoProduct.artworkKey}
                  customImageUrl={editorDemoProduct.customImageUrl}
                  showMedia
                  enableLinkPreview={tplLinkPreview}
                  previewDomain={getPreviewDomain(tplPlatform)}
                  time="23:03"
                />
              </div>
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditorOpen(false)}
                className="px-4 py-2.5 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300"
              >
                Cancelar
              </button>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold"
              >
                {editingId ? 'Atualizar Template' : 'Salvar Template'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

/* ============================================================================
 * 2. CONFIGURAÇÕES DO SITE / PÁGINA DE CAPTURA (Telas 72–76)
 * ========================================================================== */
export const SiteCaptureConfigView: React.FC = () => {
  const {
    siteCapture,
    setSiteCapture,
    dispatchGroups,
    setDispatchGroups,
    setRoute,
    notify,
  } = useApp();

  const [newAdvantage, setNewAdvantage] = useState('');
  const [previewOpen, setPreviewOpen] = useState(false);

  const captureUrl = `https://redirecionador.buboflow.com.br/captura/${siteCapture.slug || 'seu-link-aqui'}`;

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setSiteCapture((prev) => ({ ...prev, logoDataUrl: reader.result as string }));
      }
    };
    reader.readAsDataURL(file);
  };

  const addAdvantage = () => {
    if (!newAdvantage.trim()) return;
    setSiteCapture((prev) => ({
      ...prev,
      advantages: [...prev.advantages, newAdvantage.trim()],
    }));
    setNewAdvantage('');
  };

  // Resolve which group would receive the next visitor according to BuboFlow capacity rules
  const targetCaptureGroup =
    dispatchGroups.find((g) => g.isPriorityCapture && g.membersCount < 1000) ||
    dispatchGroups
      .filter((g) => siteCapture.selectedGroupIds.includes(g.id))
      .sort((a, b) => a.membersCount - b.membersCount)[0] ||
    dispatchGroups[0];

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setRoute('configuracoes')}
            className="p-2 rounded-xl hover:bg-white dark:hover:bg-slate-800"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
            Configurações do Site
          </h1>
        </div>

        <button
          type="button"
          onClick={() => setPreviewOpen(true)}
          className="px-4 py-2 rounded-xl border border-[#15803D] text-[#15803D] dark:text-emerald-400 text-xs sm:text-sm font-semibold flex items-center gap-2 hover:bg-emerald-50 dark:hover:bg-emerald-950/40"
        >
          <Eye className="w-4 h-4" />
          <span>Ver Página de Captura</span>
        </button>
      </div>

      {/* Endereço do Site */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-3">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Endereço do Site
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Personalize o link da sua página inteligente de convite para os grupos.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
            Link Captura
          </label>
          <div className="rounded-xl border border-[#15803D] overflow-hidden bg-slate-50 dark:bg-slate-800/70">
            <div className="px-3.5 py-2 text-xs text-slate-400 border-b border-slate-200/70 dark:border-slate-700 font-mono">
              redirecionador.buboflow.com.br/captura/
            </div>
            <input
              type="text"
              value={siteCapture.slug}
              onChange={(e) =>
                setSiteCapture((prev) => ({
                  ...prev,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-'),
                }))
              }
              placeholder="seu-link-aqui"
              className="w-full px-3.5 py-2.5 text-sm bg-white dark:bg-slate-900 focus:outline-none font-mono"
            />
            <div className="px-3.5 py-2 flex items-center gap-3 border-t border-slate-200/70 dark:border-slate-700">
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(captureUrl);
                  notify('Link de captura copiado!', captureUrl);
                }}
                className="text-xs font-semibold text-[#15803D] dark:text-emerald-400 flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar link completo</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Marca */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">Marca</h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Personalize a aparência da sua página VIP.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
            Cor Principal
          </label>
          <div className="flex items-center gap-3">
            <input
              type="color"
              value={siteCapture.brandColor}
              onChange={(e) =>
                setSiteCapture((prev) => ({ ...prev, brandColor: e.target.value }))
              }
              className="w-11 h-11 rounded-lg border border-slate-200 cursor-pointer"
            />
            <input
              type="text"
              value={siteCapture.brandColor}
              onChange={(e) =>
                setSiteCapture((prev) => ({ ...prev, brandColor: e.target.value }))
              }
              className="w-40 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2.5 text-sm font-mono"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-200 mb-1.5">
            Logo do Grupo
          </label>
          <label className="w-full rounded-xl border-2 border-dashed border-slate-200 dark:border-slate-700 py-7 px-4 flex flex-col items-center justify-center text-center cursor-pointer hover:border-[#15803D] transition-colors">
            {siteCapture.logoDataUrl ? (
              <img
                src={siteCapture.logoDataUrl}
                alt="Logo do Grupo"
                className="w-16 h-16 rounded-full object-cover mb-2"
              />
            ) : (
              <Upload className="w-6 h-6 text-slate-400 mb-2" />
            )}
            <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
              Clique para fazer upload
            </span>
            <span className="text-xs text-slate-400 mt-0.5">PNG, JPG ou WEBP</span>
            <input
              type="file"
              accept="image/*"
              onChange={handleLogoUpload}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {/* Configurações Página do Grupo (Telas 73–75) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Configurações Página do Grupo
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure as informações da sua página de convite ao seu grupo de ofertas.
          </p>
        </div>

        <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 p-4 text-xs text-slate-600 dark:text-slate-300 space-y-2">
          <div className="font-semibold text-slate-900 dark:text-white">
            Regras automáticas de lotação dos grupos:
          </div>
          <p>• Primeiro será exibido o grupo que estiver com menos de 80% da capacidade.</p>
          <p>
            • Um grupo marcado com prioridade (⭐) sempre será exibido primeiro até atingir
            1.000 membros.
          </p>
        </div>

        {/* Group Selector Cards */}
        <div className="space-y-2.5">
          {dispatchGroups
            .filter((g) => !g.isChannel)
            .map((grp) => {
              const checked = siteCapture.selectedGroupIds.includes(grp.id);
              return (
                <div
                  key={grp.id}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <label className="flex items-center gap-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() =>
                          setSiteCapture((prev) => ({
                            ...prev,
                            selectedGroupIds: prev.selectedGroupIds.includes(grp.id)
                              ? prev.selectedGroupIds.filter((id) => id !== grp.id)
                              : [...prev.selectedGroupIds, grp.id],
                          }))
                        }
                        className="w-4 h-4 rounded text-[#15803D]"
                      />
                      <div>
                        <div className="text-sm font-semibold">{grp.name}</div>
                        <div className="text-xs text-slate-500 tabular-nums">
                          ({grp.membersCount} membros)
                        </div>
                      </div>
                    </label>

                    <button
                      type="button"
                      onClick={() =>
                        setDispatchGroups((prev) =>
                          prev.map((item) =>
                            item.id === grp.id
                              ? { ...item, isPriorityCapture: !item.isPriorityCapture }
                              : item
                          )
                        )
                      }
                      title="Marcar como grupo prioritário"
                      className="p-1.5"
                    >
                      <Star
                        className={`w-5 h-5 ${
                          grp.isPriorityCapture
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-slate-300'
                        }`}
                      />
                    </button>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type="url"
                      value={grp.inviteUrl}
                      onChange={(e) =>
                        setDispatchGroups((prev) =>
                          prev.map((item) =>
                            item.id === grp.id
                              ? { ...item, inviteUrl: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="https://chat.whatsapp.com/..."
                      className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-mono"
                    />
                    <a
                      href={grp.inviteUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-1.5 text-slate-400 hover:text-slate-700"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              );
            })}
        </div>

        <label className="flex items-center gap-2.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
          <input
            type="checkbox"
            checked={siteCapture.randomRedirect}
            onChange={(e) =>
              setSiteCapture((prev) => ({ ...prev, randomRedirect: e.target.checked }))
            }
            className="w-4 h-4 rounded text-[#15803D]"
          />
          <span>Envio aleatório para os grupos de envio selecionados</span>
        </label>

        <div className="space-y-3 pt-2">
          <div>
            <label className="block text-xs font-semibold mb-1">Título da Página</label>
            <input
              type="text"
              value={siteCapture.pageTitle}
              onChange={(e) =>
                setSiteCapture((prev) => ({ ...prev, pageTitle: e.target.value }))
              }
              placeholder="Ex: Grupo VIP de Ofertas"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Descrição da Página</label>
            <textarea
              rows={3}
              value={siteCapture.pageDescription}
              onChange={(e) =>
                setSiteCapture((prev) => ({ ...prev, pageDescription: e.target.value }))
              }
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Descrição Extra</label>
            <input
              type="text"
              value={siteCapture.extraDescription}
              onChange={(e) =>
                setSiteCapture((prev) => ({ ...prev, extraDescription: e.target.value }))
              }
              placeholder="Ex: ⭐ Mais de 10.000 pessoas já estão no grupo"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold mb-1">Texto do Botão</label>
            <input
              type="text"
              value={siteCapture.buttonText}
              onChange={(e) =>
                setSiteCapture((prev) => ({ ...prev, buttonText: e.target.value }))
              }
              placeholder="Ex: Entrar no Grupo VIP"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
            />
          </div>

          {/* Vantagens do Grupo */}
          <div>
            <label className="block text-xs font-semibold mb-1">Vantagens do Grupo</label>
            <div className="flex items-center gap-2 mb-2">
              <input
                type="text"
                value={newAdvantage}
                onChange={(e) => setNewAdvantage(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addAdvantage();
                  }
                }}
                placeholder="Ex: ✅ Cupons todos os dias..."
                className="flex-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm"
              />
              <button
                type="button"
                onClick={addAdvantage}
                className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              {siteCapture.advantages.map((adv, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-xs"
                >
                  <span>{adv}</span>
                  <button
                    type="button"
                    onClick={() =>
                      setSiteCapture((prev) => ({
                        ...prev,
                        advantages: prev.advantages.filter((_, i) => i !== idx),
                      }))
                    }
                    className="text-rose-500"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Tracking Pixel (Tela 76) */}
      <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 p-5 space-y-4">
        <div>
          <h2 className="font-bold text-base text-slate-900 dark:text-white">
            Tracking (Pixel)
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 mt-0.5">
            Configure o Pixel do Meta para rastrear conversões de entrada no grupo.
          </p>
        </div>

        <div>
          <label className="block text-xs font-semibold mb-1">Meta Pixel ID</label>
          <input
            type="text"
            value={siteCapture.metaPixelId}
            onChange={(e) =>
              setSiteCapture((prev) => ({ ...prev, metaPixelId: e.target.value }))
            }
            placeholder="Ex: 1234567890"
            className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm font-mono"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">Modo de Teste (Debug)</span>
          <button
            type="button"
            role="switch"
            aria-checked={siteCapture.pixelDebug}
            onClick={() =>
              setSiteCapture((prev) => ({ ...prev, pixelDebug: !prev.pixelDebug }))
            }
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
              siteCapture.pixelDebug ? 'bg-[#15803D]' : 'bg-slate-200 dark:bg-slate-700'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                siteCapture.pixelDebug ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() =>
            notify('Configurações do site salvas!', 'Sua página de captura está atualizada.')
          }
          className="px-5 py-3 rounded-xl bg-[#15803D] hover:bg-emerald-800 text-white text-sm font-semibold flex items-center gap-2 shadow-sm"
        >
          <Save className="w-4 h-4" />
          <span>Salvar Configurações</span>
        </button>
      </div>

      {/* Modal: Live Preview of VIP Capture Landing Page */}
      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 p-6 shadow-2xl text-center space-y-4 relative my-auto">
            <button
              type="button"
              onClick={() => setPreviewOpen(false)}
              className="absolute top-4 right-4 p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="mx-auto w-20 h-20 rounded-full flex items-center justify-center text-white font-bold text-2xl shadow-md overflow-hidden" style={{ backgroundColor: siteCapture.brandColor }}>
              {siteCapture.logoDataUrl ? (
                <img
                  src={siteCapture.logoDataUrl}
                  alt="Logo"
                  className="w-full h-full object-cover"
                />
              ) : (
                <span>VIP</span>
              )}
            </div>

            <h3 className="text-xl font-bold text-slate-900 dark:text-white">
              {siteCapture.pageTitle}
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {siteCapture.pageDescription}
            </p>
            {siteCapture.extraDescription && (
              <div className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                {siteCapture.extraDescription}
              </div>
            )}

            <div className="text-left space-y-2 py-2">
              {siteCapture.advantages.map((adv, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs sm:text-sm text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/70 px-3.5 py-2 rounded-xl"
                >
                  <CheckCircle2 className="w-4 h-4 text-[#15803D] shrink-0" />
                  <span>{adv}</span>
                </div>
              ))}
            </div>

            <a
              href={targetCaptureGroup?.inviteUrl || 'https://chat.whatsapp.com/'}
              target="_blank"
              rel="noopener noreferrer"
              style={{ backgroundColor: siteCapture.brandColor }}
              className="block w-full py-3.5 rounded-xl text-white font-bold text-sm shadow-md hover:opacity-95 transition-opacity"
            >
              {siteCapture.buttonText}
            </a>

            <div className="text-[11px] text-slate-400">
              Redirecionando automaticamente para:{' '}
              <strong>{targetCaptureGroup?.name || 'Selecione um grupo acima'}</strong>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
