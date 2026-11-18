/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { AppShell } from './components/AppShell';
import { DashboardView } from './views/DashboardView';
import { CouponsView, ProductsCatalogView } from './views/CatalogViews';
import {
  ChannelAccountsView,
  DispatchQueuesView,
  GroupsManagementView,
  SchedulesView,
  SendMessageComposerView,
} from './views/MessagingAndChannelsViews';
import {
  CommissionReportView,
  LinkConverterView,
  MemberMonitorView,
  SentLogsView,
  VideoDownloaderView,
} from './views/ToolsAndReportsViews';
import {
  SiteCaptureConfigView,
  TemplatesConfigView,
} from './views/TemplatesAndSiteViews';
import {
  AdvancedFiltersConfigView,
  AutoDispatchConfigView,
  AutomationGroupConfigView,
  MonitoringAutoConfigView,
  PlatformsConfigView,
  ProfileView,
  ReferralsView,
  SegmentsView,
  SettingsHubView,
} from './views/SettingsAndAccountViews';

const RouterViewport: React.FC = () => {
  const { route } = useApp();

  switch (route) {
    case 'dashboard':
      return <DashboardView />;
    case 'whatsapp':
      return <ChannelAccountsView channel="WhatsApp" />;
    case 'telegram':
      return <ChannelAccountsView channel="Telegram" />;
    case 'enviar-mensagens':
      return <SendMessageComposerView />;
    case 'produtos':
      return <ProductsCatalogView mode="produtos" />;
    case 'produtos-favoritos':
      return <ProductsCatalogView mode="favoritos" />;
    case 'vitrine-ofertas':
      return <ProductsCatalogView mode="vitrine" />;
    case 'cupons':
      return <CouponsView />;
    case 'grupos-envio':
      return <GroupsManagementView mode="envio" />;
    case 'grupos-monitoramento':
      return <GroupsManagementView mode="monitoramento" />;
    case 'agendamentos':
      return <SchedulesView />;
    case 'filas-disparo':
      return <DispatchQueuesView />;
    case 'download-videos':
      return <VideoDownloaderView />;
    case 'conversao-link':
      return <LinkConverterView />;
    case 'comissao':
      return <CommissionReportView />;
    case 'envios':
      return <SentLogsView />;
    case 'monitor-membros':
      return <MemberMonitorView />;
    case 'configuracoes':
      return <SettingsHubView />;
    case 'config-disparo-automatico':
      return <AutoDispatchConfigView />;
    case 'config-grupo-automacao':
      return <AutomationGroupConfigView />;
    case 'config-site':
      return <SiteCaptureConfigView />;
    case 'config-templates':
      return <TemplatesConfigView />;
    case 'config-plataformas':
      return <PlatformsConfigView />;
    case 'config-monitoramento':
      return <MonitoringAutoConfigView />;
    case 'config-avancadas':
      return <AdvancedFiltersConfigView />;
    case 'indicacoes':
      return <ReferralsView />;
    case 'perfil':
      return <ProfileView />;
    case 'segmentos':
      return <SegmentsView />;
    default:
      return <DashboardView />;
  }
};

export default function App() {
  return (
    <AppProvider>
      <AppShell>
        <RouterViewport />
      </AppShell>
    </AppProvider>
  );
}
