import React from 'react';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { useApp } from '../../context/AppContext';
import { Alert, Btn, Icon, LoadingState, ErrorState } from '../ui';

// Public privacy notice built from the technical facts the server reports.
// Legal content the controller has not filled in is shown as a placeholder —
// nothing here claims LGPD compliance.
const PENDING = '[A PREENCHER PELO CONTROLADOR]';
const LEGAL_BASIS = '[A DEFINIR PELO CONTROLADOR COM ASSESSORIA JURÍDICA]';

const RETENTION_LABEL = {
  notificationsDays: 'Notificações', trashDays: 'Itens na lixeira', invitationsDays: 'Convites encerrados',
  systemEventsDays: 'Eventos técnicos do sistema', webhookDeliveriesDays: 'Registros de entrega de webhooks',
  automationLogsDays: 'Registros de automações', auditLogsDays: 'Registros de auditoria de segurança',
  auditIpDays: 'IP e navegador nos registros de auditoria (depois truncados)', closedIncidentsDays: 'Incidentes de segurança encerrados',
  privacyRequestsDays: 'Solicitações de titulares concluídas'
};

const SECURITY = [
  'Tráfego protegido por HTTPS/TLS e cabeçalhos de segurança (CSP, HSTS, proteção contra framing).',
  'Sessões em cookies HttpOnly e Secure, com expiração e encerramento remoto.',
  'Senhas armazenadas apenas como hash (bcrypt); verificação em duas etapas (TOTP) disponível.',
  'Segredos de autenticação e de integrações cifrados com AES-256-GCM.',
  'Isolamento entre workspaces e controle de acesso por papel verificados no servidor.',
  'Backups diários cifrados, guardados separadamente, com teste de restauração.',
  'Trilha de auditoria protegida contra adulteração e detecção automática de atividades suspeitas.'
];

function Section({ title, children }) {
  return (
    <section className="py-6 border-t border-border first:border-0">
      <h2 className="text-[16px] font-semibold text-text-primary mb-3">{title}</h2>
      <div className="text-[13px] text-text-secondary leading-relaxed space-y-3">{children}</div>
    </section>
  );
}

function Table({ head, rows }) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[12px] text-left" style={{ minWidth: 560 }}>
        <thead className="bg-surface-card text-text-muted"><tr>{head.map(h => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-border align-top">{r.map((c, j) => <td key={j} className="px-3 py-2.5 text-text-secondary">{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const orPending = value => value || <span className="text-amber-400">{PENDING}</span>;

export function PrivacyPolicyView() {
  const { auth, navigate } = useApp();
  const { data: p, loading, error, reload } = useAsync(() => api.privacy.policy(), []);
  const back = () => (auth.status === 'authed' ? navigate('/settings/privacy') : (window.location.href = '/'));

  return (
    <div className="min-h-screen bg-background">
      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between gap-3 mb-6">
          <a href="/" className="flex items-center gap-2"><img src="/logo.svg" alt="" className="w-7 h-7" /><span className="text-[15px] font-semibold text-text-primary">Taskly</span></a>
          <Btn icon="arrow_back" onClick={back}>Voltar</Btn>
        </div>
        <h1 className="text-title-lg text-text-primary">Política de Privacidade</h1>
        {loading && <div className="mt-6"><LoadingState rows={5} /></div>}
        {error && <ErrorState error={error} onRetry={reload} />}
        {p && (
          <>
            <p className="text-[12px] text-text-muted mt-1">Versão {p.version} · atualizada em {p.updatedAt}</p>
            {!p.reviewedByLegal && (
              <div className="mt-4"><Alert tone="warning">
                <strong>Rascunho técnico — pendente de revisão jurídica.</strong> Este texto descreve como o sistema trata dados pessoais, a partir da própria configuração do sistema. Informações sobre controlador, encarregado e bases legais ainda precisam ser definidas e revisadas pelo responsável pelo serviço.
              </Alert></div>
            )}

            <Section title="1. Quem é o responsável">
              <p><strong className="text-text-primary">Controlador:</strong> {orPending(p.controller.name)}{p.controller.document ? ` — ${p.controller.document}` : ''}</p>
              <p><strong className="text-text-primary">Endereço:</strong> {orPending(p.controller.address)}</p>
              <p><strong className="text-text-primary">Encarregado (DPO):</strong> {orPending(p.dpo.name)} {p.dpo.email && <>— <a className="text-text-primary underline" href={`mailto:${p.dpo.email}`}>{p.dpo.email}</a></>}</p>
              <p><strong className="text-text-primary">Contato para privacidade:</strong> {p.controller.contactEmail ? <a className="text-text-primary underline" href={`mailto:${p.controller.contactEmail}`}>{p.controller.contactEmail}</a> : orPending('')}</p>
            </Section>

            <Section title="2. Dados tratados, finalidades e prazos">
              <p>Coletamos apenas o necessário para o funcionamento do serviço. Não usamos seus dados para publicidade, criação de perfis de comportamento, marketing externo ou treinamento de modelos.</p>
              <Table head={['Categoria', 'Dados', 'Finalidade', 'Base legal', 'Retenção']} rows={p.categories.map(c => [c.label, c.fields, c.purpose, <span key="b" className="text-amber-400">{LEGAL_BASIS}</span>, c.retention])} />
            </Section>

            <Section title="3. Compartilhamento e operadores">
              <p>Os dados só são enviados a terceiros quando necessário para prestar o serviço:</p>
              <Table head={['Serviço', 'Dados envolvidos', 'Localização', 'Situação']} rows={p.processors.map(s => [s.name, s.data, s.location, s.active ? 'Em uso' : 'Não utilizado nesta instalação'])} />
            </Section>

            <Section title="4. Transferência internacional">
              <p>Alguns serviços acima podem processar dados fora do Brasil. O mecanismo de transferência aplicável a cada um é: <span className="text-amber-400">{LEGAL_BASIS}</span></p>
            </Section>

            <Section title="5. Por quanto tempo guardamos">
              <p>Os dados da conta e do trabalho ficam guardados enquanto a conta e o workspace existirem. Outros registros são removidos ou anonimizados automaticamente:</p>
              <ul className="list-disc pl-5 space-y-1">
                {Object.entries(RETENTION_LABEL).map(([k, label]) => (
                  <li key={k}>{label}: {p.retention[k] ? `${p.retention[k]} dias` : 'sem prazo automático definido'}</li>
                ))}
                <li>Backups: as {p.retention.backupsKeep} cópias mais recentes.</li>
              </ul>
            </Section>

            <Section title="6. Segurança">
              <ul className="list-disc pl-5 space-y-1">{SECURITY.map(s => <li key={s}>{s}</li>)}</ul>
              <p>Nenhum sistema é totalmente imune a falhas. Incidentes são registrados, avaliados e, quando exigido, comunicados à ANPD e às pessoas afetadas.</p>
            </Section>

            <Section title="7. Cookies e armazenamento no navegador">
              <p>Usamos apenas cookies estritamente necessários. <strong className="text-text-primary">Não há cookies de publicidade nem de análise.</strong></p>
              <Table head={['Cookie', 'Categoria', 'Finalidade', 'Duração']} rows={p.cookies.map(c => [<span key="n" className="font-mono">{c.name}</span>, c.category, c.purpose, c.duration])} />
              <p>Também guardamos no seu navegador preferências de uso, sem dados pessoais:</p>
              <ul className="list-disc pl-5 space-y-1">{p.localStorage.map(l => <li key={l.name}><span className="font-mono text-[12px]">{l.name}</span> — {l.purpose}</li>)}</ul>
            </Section>

            <Section title="8. Seus direitos">
              <p>Você pode solicitar:</p>
              <ul className="list-disc pl-5 space-y-1">{Object.values(p.requestTypes).map(t => <li key={t}>{t}</li>)}</ul>
              <p>
                Com a conta aberta, use a <strong className="text-text-primary">Central de Privacidade</strong> (Configurações → Central de Privacidade) para exportar seus dados, abrir solicitações ou excluir a conta.
                {' '}Você também pode escrever para {p.controller.contactEmail || p.dpo.email || PENDING}.
              </p>
              {auth.status === 'authed' && <Btn icon="shield_person" onClick={() => navigate('/settings/privacy')}>Abrir Central de Privacidade</Btn>}
            </Section>
          </>
        )}
        <p className="text-[11px] text-text-muted mt-6 flex items-center gap-1"><Icon name="info" size={14} />Esta página é gerada a partir da configuração do sistema.</p>
      </main>
    </div>
  );
}
