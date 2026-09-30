import React from 'react';
import { useApp } from '../../context/AppContext';
import { Field, Icon, PageHeader, Select } from '../ui';
import { ProfileSection, SecuritySection } from '../settings/AccountSections';
import { PrivacyCenterSection } from '../settings/PrivacySections';
import { AppearanceSection, LanguageSection, NotificationPrefsSection, ShortcutsSection } from '../settings/PreferenceSections';
import { MembersLinkSection, WorkspaceSection } from '../settings/WorkspaceSections';
import { PermissionMatrixSection } from '../settings/PermissionMatrix';
import { ApiKeysSection } from '../settings/ApiKeysSection';
import { WebhooksSection } from '../settings/WebhooksSection';
import { AppsSection, BillingSection } from '../settings/IntegrationSections';

const GROUPS = [
  { label: 'Conta', items: [
    { id: 'profile', label: 'Perfil', icon: 'person', Component: ProfileSection },
    { id: 'security', label: 'Segurança', icon: 'shield', Component: SecuritySection },
    { id: 'privacy', label: 'Central de Privacidade', icon: 'shield_person', Component: PrivacyCenterSection }
  ] },
  { label: 'Preferências', items: [
    { id: 'appearance', label: 'Aparência', icon: 'palette', Component: AppearanceSection },
    { id: 'language', label: 'Idioma', icon: 'translate', Component: LanguageSection },
    { id: 'notifications', label: 'Notificações', icon: 'notifications', Component: NotificationPrefsSection },
    { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard', Component: ShortcutsSection }
  ] },
  { label: 'Workspace', items: [
    { id: 'workspace', label: 'Geral', icon: 'business', Component: WorkspaceSection },
    { id: 'members', label: 'Membros', icon: 'group', Component: MembersLinkSection },
    { id: 'permissions', label: 'Permissões', icon: 'admin_panel_settings', Component: PermissionMatrixSection }
  ] },
  { label: 'Integrações', items: [
    { id: 'apps', label: 'Aplicativos conectados', icon: 'extension', Component: AppsSection },
    { id: 'api', label: 'Chaves de API', icon: 'key', Component: ApiKeysSection },
    { id: 'webhooks', label: 'Webhooks', icon: 'webhook', Component: WebhooksSection }
  ] },
  { label: 'Cobrança', items: [
    { id: 'billing', label: 'Plano e faturas', icon: 'credit_card', Component: BillingSection }
  ] }
];
const ALL = GROUPS.flatMap(g => g.items);

export function SettingsView() {
  const { params, navigate, currentWorkspace } = useApp();
  const active = ALL.find(i => i.id === params.id) || ALL[0];
  const go = id => navigate(`/settings/${id}`);
  const { Component } = active;

  return (
    <div className="p-4 sm:p-6 max-w-[1600px] mx-auto">
      <PageHeader icon="settings" title="Configurações" description={`Sua conta e o workspace ${currentWorkspace?.name || ''}`.trim()} />
      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:hidden">
          <Field label="Seção">
            <Select value={active.id} onChange={e => go(e.target.value)}>
              {GROUPS.map(g => (
                <optgroup key={g.label} label={g.label}>
                  {g.items.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
                </optgroup>
              ))}
            </Select>
          </Field>
        </div>
        <nav aria-label="Seções das configurações" className="hidden md:block w-56 flex-shrink-0">
          <div className="sticky top-4 flex flex-col gap-5">
            {GROUPS.map(g => (
              <div key={g.label}>
                <div className="px-2.5 mb-1.5 text-[10px] font-mono uppercase tracking-wider text-text-muted">{g.label}</div>
                <ul className="flex flex-col gap-0.5">
                  {g.items.map(i => (
                    <li key={i.id}>
                      <button type="button" onClick={() => go(i.id)} aria-current={i.id === active.id ? 'page' : undefined}
                        className={`w-full flex items-center gap-2 h-8 px-2.5 rounded-lg text-[12px] text-left transition-colors ${i.id === active.id ? 'bg-surface-elevated text-text-primary font-medium border border-border' : 'text-text-secondary hover:text-text-primary hover:bg-surface-hover border border-transparent'}`}>
                        <Icon name={i.icon} size={16} />
                        <span className="truncate">{i.label}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <section className="flex-1 min-w-0" aria-label={active.label}>
          <h2 className="sr-only">{active.label}</h2>
          <Component key={active.id} />
        </section>
      </div>
    </div>
  );
}
