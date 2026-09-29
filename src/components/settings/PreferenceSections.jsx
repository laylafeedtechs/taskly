import React, { useEffect, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { api } from '../../services/api';
import { useAsync } from '../../lib/hooks';
import { Alert, AsyncBoundary, Btn, Checkbox, Field, Icon, Kbd, Select, Toggle } from '../ui';
import { Section, TableWrap, Td, Th } from './common';

// Saves theme/language together, optimistically, since the API replaces both.
function usePreferences() {
  const { user, setUser, showError } = useApp();
  const prefs = { theme: 'dark', language: 'pt-BR', ...user.preferences };
  const [saving, setSaving] = useState(false);
  const save = async patch => {
    const previous = user;
    const next = { ...prefs, ...patch };
    setUser({ ...user, preferences: next });
    setSaving(true);
    try {
      const res = await api.auth.updateProfile({ preferences: next });
      setUser(res.user);
      return true;
    } catch (err) {
      setUser(previous);
      showError(err);
      return false;
    } finally { setSaving(false); }
  };
  return { prefs, save, saving };
}

const THEMES = [
  { value: 'dark', label: 'Escuro', icon: 'dark_mode', description: 'Visual padrão do Taskly, confortável para longas sessões.' },
  { value: 'light', label: 'Claro', icon: 'light_mode', description: 'Alto contraste para ambientes bem iluminados.' },
  { value: 'system', label: 'Sistema', icon: 'contrast', description: 'Acompanha a preferência do seu sistema operacional.' }
];

export function AppearanceSection() {
  const { toast } = useApp();
  const { prefs, save, saving } = usePreferences();
  const choose = async theme => { if (theme !== prefs.theme && await save({ theme })) toast('Tema atualizado', 'success'); };
  return (
    <Section title="Tema" description="A mudança é aplicada imediatamente e salva na sua conta.">
      <div role="radiogroup" aria-label="Tema" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {THEMES.map(t => {
          const active = prefs.theme === t.value;
          return (
            <button key={t.value} type="button" role="radio" aria-checked={active} disabled={saving} onClick={() => choose(t.value)}
              className={`text-left rounded-xl border p-4 transition-colors disabled:opacity-70 ${active ? 'border-blue-500/60 bg-blue-500/10' : 'border-border bg-background-secondary/50 hover:border-border-focus'}`}>
              <div className="flex items-center justify-between">
                <Icon name={t.icon} size={20} className={active ? 'text-blue-400' : 'text-text-secondary'} />
                {active && <Icon name="check_circle" size={18} filled className="text-blue-400" />}
              </div>
              <div className="text-[13px] font-semibold text-text-primary mt-3">{t.label}</div>
              <div className="text-[11px] text-text-muted mt-0.5">{t.description}</div>
            </button>
          );
        })}
      </div>
    </Section>
  );
}

export function LanguageSection() {
  const { toast } = useApp();
  const { prefs, save, saving } = usePreferences();
  const change = async e => { if (await save({ language: e.target.value })) toast('Idioma salvo', 'success'); };
  return (
    <Section title="Idioma" description="Idioma preferido para a interface e os e-mails.">
      <div className="flex flex-col gap-4 max-w-md">
        <Field label="Idioma">
          <Select value={prefs.language} onChange={change} disabled={saving}>
            <option value="pt-BR">Português (Brasil)</option>
            <option value="en">English</option>
          </Select>
        </Field>
        <Alert>No momento, a interface do Taskly está disponível apenas em português. Sua preferência fica salva e será aplicada quando outros idiomas forem disponibilizados.</Alert>
      </div>
    </Section>
  );
}

const EVENT_META = {
  assignment: { label: 'Atribuições', description: 'Quando uma tarefa é atribuída a você' },
  mention: { label: 'Menções', description: 'Quando alguém menciona você com @' },
  comment: { label: 'Comentários', description: 'Novos comentários nas suas tarefas' },
  deadline: { label: 'Prazos', description: 'Tarefas vencendo ou atrasadas' },
  automation: { label: 'Automações', description: 'Avisos enviados por regras de automação' },
  invitation: { label: 'Convites', description: 'Convites para workspaces' },
  security: { label: 'Segurança', description: 'Senha, e-mail, papéis e acessos' }
};

function normalize(prefs, events) {
  const out = { inApp: prefs?.inApp !== false, email: prefs?.email !== false, events: {} };
  events.forEach(e => {
    const p = prefs?.events?.[e] || {};
    out.events[e] = e === 'security' ? { inApp: true, email: true } : { inApp: p.inApp !== false, email: p.email === true };
  });
  return out;
}

export function NotificationPrefsSection() {
  const { toast, showError } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.notifications.preferences(), []);
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const events = data?.events || [];
  const locked = new Set(data?.locked || []);

  useEffect(() => { if (data) setForm(normalize(data.preferences, data.events)); }, [data]);

  const initial = data ? JSON.stringify(normalize(data.preferences, data.events)) : null;
  const dirty = form && JSON.stringify(form) !== initial;
  const setEvent = (e, channel, value) => setForm(f => ({ ...f, events: { ...f.events, [e]: { ...f.events[e], [channel]: value } } }));

  const save = async () => {
    setSaving(true);
    try {
      await api.notifications.updatePreferences(form);
      await reload();
      toast('Preferências de notificação salvas', 'success');
    } catch (err) { showError(err); } finally { setSaving(false); }
  };

  return (
    <Section title="Notificações" description="Escolha como e quando você quer ser avisado."
      actions={form && <Btn variant="primary" icon="save" loading={saving} disabled={!dirty} onClick={save}>Salvar preferências</Btn>}>
      <AsyncBoundary loading={loading || (data && !form)} error={error} onRetry={reload}>
        {form && (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-lg border border-border bg-background-secondary/50 p-4">
              <Toggle checked={form.inApp} onChange={inApp => setForm(f => ({ ...f, inApp }))} label="Notificações no aplicativo" description="Exibidas no sino e na central de notificações." />
              <Toggle checked={form.email} onChange={email => setForm(f => ({ ...f, email }))} label="Notificações por e-mail" description="Enviadas para o e-mail da sua conta." />
            </div>
            <TableWrap minWidth={480}>
              <thead><tr><Th>Evento</Th><Th className="text-center w-28">No app</Th><Th className="text-center w-28">E-mail</Th></tr></thead>
              <tbody>
                {events.map(e => {
                  const isLocked = locked.has(e);
                  const meta = EVENT_META[e] || { label: e };
                  return (
                    <tr key={e}>
                      <th scope="row" className="text-left font-normal px-3 py-2.5 border-b border-border-subtle">
                        <div className="flex items-center gap-1.5 text-[13px] text-text-primary">{meta.label}{isLocked && <Icon name="lock" size={13} className="text-text-muted" label="Obrigatório" />}</div>
                        {meta.description && <div className="text-[11px] text-text-muted">{meta.description}</div>}
                      </th>
                      {['inApp', 'email'].map(channel => (
                        <Td key={channel} className="text-center">
                          <Checkbox
                            checked={form.events[e][channel]}
                            disabled={isLocked || !form[channel]}
                            onChange={v => setEvent(e, channel, v)}
                            label={`${meta.label}: ${channel === 'inApp' ? 'no app' : 'por e-mail'}`}
                            className="disabled:opacity-50 disabled:cursor-not-allowed"
                          />
                        </Td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
            <p className="text-[11px] text-text-muted">
              Notificações de segurança são obrigatórias nos dois canais para proteger sua conta. Desativar um canal geral desativa todos os eventos daquele canal (exceto segurança).
            </p>
          </div>
        )}
      </AsyncBoundary>
    </Section>
  );
}

const SHORTCUTS = [
  [['N'], 'Nova tarefa'],
  [['P'], 'Ir para Projetos'],
  [['C'], 'Ir para Calendário'],
  [['R'], 'Ir para Relatórios'],
  [['G', 'D'], 'Ir para Dashboard'],
  [['G', 'T'], 'Ir para Minhas tarefas'],
  [['G', 'K'], 'Ir para Kanban'],
  [['G', 'N'], 'Ir para Notificações'],
  [['G', 'S'], 'Ir para Configurações'],
  [['Ctrl/⌘', 'K'], 'Abrir a paleta de comandos'],
  [['/'], 'Buscar'],
  [['?'], 'Mostrar atalhos'],
  [['Esc'], 'Fechar janelas e painéis']
];

export function ShortcutsSection() {
  const { setShortcutsOpen } = useApp();
  return (
    <Section title="Atalhos de teclado" description="Atalhos funcionam fora de campos de texto. Sequências (G → D) devem ser digitadas em até 1 segundo."
      actions={<Btn icon="keyboard" onClick={() => setShortcutsOpen(true)}>Abrir painel de atalhos</Btn>}>
      <TableWrap minWidth={360}>
        <thead><tr><Th>Atalho</Th><Th>Ação</Th></tr></thead>
        <tbody>
          {SHORTCUTS.map(([keys, label]) => (
            <tr key={label}>
              <Td className="whitespace-nowrap">
                <span className="inline-flex items-center gap-1">
                  {keys.map((k, i) => <React.Fragment key={k}>{i > 0 && <span className="text-text-muted text-[10px]">{keys[0] === 'G' ? '→' : '+'}</span>}<Kbd>{k}</Kbd></React.Fragment>)}
                </span>
              </Td>
              <Td className="text-text-primary">{label}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Section>
  );
}
