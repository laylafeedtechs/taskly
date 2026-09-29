import React from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { Alert, Btn, Icon, Pill, Skeleton } from '../ui';
import { Section } from './common';

function AppRow({ icon, name, description, status, action }) {
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3.5">
      <span className="w-10 h-10 rounded-lg bg-surface-elevated border border-border flex items-center justify-center flex-shrink-0"><Icon name={icon} size={20} className="text-text-secondary" /></span>
      <div className="flex-1 min-w-[200px]">
        <div className="text-[13px] text-text-primary font-medium">{name}</div>
        <div className="text-[11px] text-text-muted mt-0.5">{description}</div>
      </div>
      {status}
      {action}
    </li>
  );
}

const ON = 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25';

export function AppsSection() {
  const { user, can, navigate } = useApp();
  const providers = useAsync(() => api.auth.providers(), []);
  const googleConfigured = providers.data?.google;

  const googleDescription = providers.loading ? 'Verificando configuração…'
    : providers.error ? 'Não foi possível verificar a configuração do login com Google.'
      : !googleConfigured ? 'O login com Google não está configurado nesta instalação.'
        : user.googleLinked ? `Login com Google ativo para ${user.email}.` : 'Disponível. Entre com o Google usando o mesmo e-mail para vincular.';

  return (
    <div className="flex flex-col gap-5">
      <Section title="Aplicativos conectados" description="Serviços externos vinculados à sua conta e a este workspace.">
        <ul className="divide-y divide-border-subtle border border-border rounded-lg">
          <AppRow
            icon="account_circle"
            name="Google (login)"
            description={googleDescription}
            status={providers.loading ? <Skeleton className="h-5 w-20" /> : <Pill className={user.googleLinked ? ON : undefined}>{user.googleLinked ? 'Conectado' : 'Não conectado'}</Pill>}
          />
          <AppRow
            icon="key"
            name="API REST"
            description="Integre qualquer sistema usando chaves de API com escopos."
            action={can('apikeys.manage') && <Btn size="xs" iconRight="arrow_forward" onClick={() => navigate('/settings/api')}>Chaves de API</Btn>}
          />
          <AppRow
            icon="webhook"
            name="Webhooks"
            description="Envie eventos de tarefas e projetos para outros serviços em tempo real."
            action={can('webhooks.manage') && <Btn size="xs" iconRight="arrow_forward" onClick={() => navigate('/settings/webhooks')}>Webhooks</Btn>}
          />
        </ul>
      </Section>
      <Alert>
        Esta instalação não inclui conectores nativos para Slack, GitHub, Google Drive ou outros serviços. Essas integrações podem ser construídas com as chaves de API e os webhooks do workspace (por exemplo, via n8n, Zapier ou Make).
      </Alert>
    </div>
  );
}

export function BillingSection() {
  const { currentWorkspace } = useApp();
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="warning">A cobrança não está configurada nesta instalação. Não há assinaturas, pagamentos ou faturas a exibir.</Alert>
      <Section title="Plano">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="text-title-sm text-text-primary">Gratuito (auto-hospedado)</div>
            <p className="text-[12px] text-text-secondary mt-0.5">Todos os recursos desta instalação estão disponíveis para {currentWorkspace?.name || 'este workspace'}.</p>
          </div>
          <Pill className={ON}>Ativo</Pill>
        </div>
      </Section>
      <Section title="Assinatura">
        <p className="text-[12px] text-text-muted">Nenhuma assinatura ativa.</p>
      </Section>
      <Section title="Faturas">
        <p className="text-[12px] text-text-muted">Nenhuma fatura emitida.</p>
      </Section>
    </div>
  );
}
