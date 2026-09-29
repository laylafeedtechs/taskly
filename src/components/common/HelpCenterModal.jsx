import React, { useMemo, useState } from 'react';
import { useApp } from '../../context/AppContext';
import { Modal, SearchInput, Kbd, Icon, Tabs, Btn } from '../ui';

export const SHORTCUTS = [
  { keys: ['Ctrl/⌘', 'K'], label: 'Abrir busca e paleta de comandos' },
  { keys: ['/'], label: 'Abrir busca' },
  { keys: ['N'], label: 'Nova tarefa' },
  { keys: ['P'], label: 'Projetos' },
  { keys: ['C'], label: 'Calendário' },
  { keys: ['R'], label: 'Relatórios' },
  { keys: ['G', 'D'], label: 'Ir para o Dashboard' },
  { keys: ['G', 'T'], label: 'Ir para Minhas tarefas' },
  { keys: ['G', 'K'], label: 'Ir para o Kanban' },
  { keys: ['G', 'N'], label: 'Ir para Notificações' },
  { keys: ['G', 'A'], label: 'Ir para Automações' },
  { keys: ['G', 'S'], label: 'Ir para Configurações' },
  { keys: ['?'], label: 'Mostrar atalhos' },
  { keys: ['Esc'], label: 'Fechar painel ou diálogo' },
  { keys: ['Ctrl', 'Enter'], label: 'Enviar formulário / comentário' }
];

const GUIDES = [
  { id: 'start', category: 'Primeiros passos', title: 'Como começar', body: 'Crie ou escolha um workspace no seletor da barra lateral, crie um projeto (em branco ou a partir de um template) e adicione tarefas com a tecla N. Convide pessoas em Equipe e defina o papel de cada uma.' },
  { id: 'workspaces', category: 'Primeiros passos', title: 'Workspaces e isolamento', body: 'Cada workspace tem seus próprios projetos, tarefas, membros, automações e integrações. Você só vê workspaces dos quais é membro, e o servidor bloqueia qualquer acesso a dados de outros workspaces.' },
  { id: 'roles', category: 'Equipe', title: 'Papéis e permissões', body: 'Proprietário: controle total. Gestor: gerencia membros, automações, chaves de API e webhooks. Membro: cria e edita projetos e tarefas. Leitor: visualiza e comenta. A matriz completa está em Configurações → Permissões.' },
  { id: 'invites', category: 'Equipe', title: 'Convites', body: 'Convites expiram em 7 dias, só podem ser usados uma vez e precisam ser aceitos com o e-mail convidado. Um novo convite para o mesmo e-mail invalida o anterior.' },
  { id: 'kanban', category: 'Tarefas', title: 'Kanban, filtros e ações em massa', body: 'Arraste cartões entre colunas ou use o menu do cartão para mover pelo teclado. A busca considera título, ID, tags e descrição e funciona junto com os filtros. Selecione várias tarefas para mover, atribuir, alterar prioridade, tags, prazo, arquivar ou excluir de uma vez — com opção de desfazer.' },
  { id: 'deps', category: 'Tarefas', title: 'Dependências', body: 'Em "Bloqueada por" indique as tarefas que precisam terminar antes. Uma tarefa bloqueada não pode ir para Revisão, Testes ou Concluído até as dependências serem concluídas, a menos que você confirme ignorar — a decisão fica registrada no histórico. Dependências circulares são recusadas.' },
  { id: 'recurring', category: 'Tarefas', title: 'Tarefas recorrentes', body: 'Defina recorrência diária, semanal (com dias da semana), mensal ou personalizada. Ao concluir a tarefa, a próxima ocorrência é criada automaticamente com o checklist reiniciado.' },
  { id: 'trash', category: 'Tarefas', title: 'Lixeira e desfazer', body: 'Exclusões vão para a Lixeira e podem ser restauradas. Ações como mover, arquivar ou excluir mostram "Desfazer" por alguns segundos. A exclusão permanente exige confirmação digitada e permissão específica.' },
  { id: 'health', category: 'Projetos', title: 'Saúde do projeto', body: 'Calculada apenas com dados objetivos. Crítico: prazo do projeto vencido com trabalho aberto, 3+ tarefas atrasadas ou 25%+ das tarefas abertas atrasadas. Em risco: qualquer tarefa atrasada ou bloqueada, ou prazo em até 7 dias com menos de 70% concluído. Saudável: nenhum desses sinais.' },
  { id: 'templates', category: 'Projetos', title: 'Templates', body: 'Templates definem colunas, tags, tipos de tarefa, marcos e tarefas padrão. Use os templates prontos ou salve qualquer projeto como template.' },
  { id: 'automations', category: 'Automações', title: 'Automações WHEN → IF → THEN', body: 'Escolha um gatilho (ex.: tarefa movida para Revisão), condições opcionais (ex.: prioridade Alta) e ações (notificar, alterar prioridade, mover, adicionar tag, atribuir). Cada execução gera um log com resultado e erro, se houver.' },
  { id: 'reports', category: 'Relatórios', title: 'Relatórios e exportação', body: 'Filtre por período, projetos, pessoas, prioridade, tipo e tags. Salve configurações para reutilizar e exporte em PDF, CSV ou Excel — a exportação respeita os filtros ativos.' },
  { id: 'api', category: 'Integrações', title: 'API e webhooks', body: 'Crie chaves de API com escopos em Configurações → API; o segredo aparece apenas uma vez. Webhooks enviam eventos assinados com HMAC-SHA256 no cabeçalho X-Taskly-Signature e têm política de novas tentativas.' },
  { id: 'security', category: 'Conta', title: 'Segurança da conta', body: 'Sessões usam cookies HttpOnly e expiram por inatividade. Em Configurações → Segurança você altera a senha e encerra sessões em outros dispositivos. Notificações de segurança não podem ser desativadas.' }
];

const FAQ = [
  ['Por que não vejo um projeto que meu colega vê?', 'Projetos pertencem a workspaces. Verifique se você está no workspace correto e se é membro dele.'],
  ['Posso recuperar uma tarefa excluída?', 'Sim. Abra a Lixeira e clique em Restaurar. Apenas a exclusão permanente não pode ser desfeita.'],
  ['Como altero o papel de alguém?', 'Em Equipe, se você for Proprietário ou Gestor. Gestores só podem atribuir Membro ou Leitor.'],
  ['O login com Google não funciona.', 'O administrador do servidor precisa configurar GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET.'],
  ['Não recebi o e-mail de convite ou de senha.', 'Se o servidor não tiver SMTP configurado, os e-mails ficam na caixa de saída local e o link é exibido para quem criou o convite.']
];

export function ShortcutList() {
  return (
    <ul className="divide-y divide-border">
      {SHORTCUTS.map(s => (
        <li key={s.label} className="flex items-center justify-between gap-4 py-2">
          <span className="text-[13px] text-text-secondary">{s.label}</span>
          <span className="flex items-center gap-1">{s.keys.map((k, i) => <React.Fragment key={k}>{i > 0 && <span className="text-[10px] text-text-muted">{s.keys.length === 2 && s.keys[0] === 'G' ? 'depois' : '+'}</span>}<Kbd>{k}</Kbd></React.Fragment>)}</span>
        </li>
      ))}
    </ul>
  );
}

export function ShortcutsModal() {
  const { shortcutsOpen, setShortcutsOpen } = useApp();
  return (
    <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Atalhos de teclado" description="Atalhos funcionam quando nenhum campo de texto está em foco.">
      <ShortcutList />
    </Modal>
  );
}

export function HelpCenterModal() {
  const { helpOpen, setHelpOpen, setOnboardingOpen, openQuickCreate } = useApp();
  const [q, setQ] = useState('');
  const [tab, setTab] = useState('guides');
  const [openId, setOpenId] = useState('start');
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? GUIDES.filter(g => `${g.title} ${g.body} ${g.category}`.toLowerCase().includes(s)) : GUIDES;
  }, [q]);
  const faq = useMemo(() => { const s = q.trim().toLowerCase(); return s ? FAQ.filter(([a, b]) => `${a} ${b}`.toLowerCase().includes(s)) : FAQ; }, [q]);

  if (!helpOpen) return null;
  const groups = [...new Set(filtered.map(g => g.category))];

  return (
    <Modal open onClose={() => setHelpOpen(false)} title="Central de ajuda" size="lg"
      footer={<>
        <Btn icon="add_task" onClick={() => { setHelpOpen(false); openQuickCreate(); }}>Criar uma tarefa</Btn>
        <Btn icon="school" onClick={() => { setHelpOpen(false); setOnboardingOpen(true); }}>Configuração inicial</Btn>
        <Btn variant="primary" onClick={() => setHelpOpen(false)}>Fechar</Btn>
      </>}>
      <SearchInput value={q} onChange={setQ} placeholder="Buscar na ajuda…" className="mb-3" data-autofocus />
      <Tabs value={tab} onChange={setTab} className="mb-3" tabs={[{ id: 'guides', label: 'Guias', icon: 'menu_book' }, { id: 'faq', label: 'Perguntas frequentes', icon: 'quiz' }, { id: 'shortcuts', label: 'Atalhos', icon: 'keyboard' }]} />
      <div className="max-h-[55vh] overflow-y-auto pr-1">
        {tab === 'guides' && (filtered.length ? groups.map(cat => (
          <section key={cat} className="mb-3">
            <h3 className="text-[10px] font-mono uppercase tracking-wider text-text-muted mb-1.5">{cat}</h3>
            {filtered.filter(g => g.category === cat).map(g => (
              <div key={g.id} className="border border-border rounded-lg mb-1.5 overflow-hidden">
                <button type="button" aria-expanded={openId === g.id} onClick={() => setOpenId(openId === g.id ? null : g.id)} className="w-full flex items-center justify-between px-3 py-2.5 text-left text-[13px] font-medium text-text-primary hover:bg-surface-hover">
                  {g.title}<Icon name={openId === g.id ? 'expand_less' : 'expand_more'} size={18} className="text-text-muted" />
                </button>
                {openId === g.id && <p className="px-3 pb-3 text-[12px] leading-relaxed text-text-secondary">{g.body}</p>}
              </div>
            ))}
          </section>
        )) : <p className="text-[13px] text-text-secondary py-6 text-center">Nenhum guia encontrado.</p>)}
        {tab === 'faq' && (faq.length ? faq.map(([question, answer]) => (
          <div key={question} className="py-2.5 border-b border-border last:border-0">
            <p className="text-[13px] font-medium text-text-primary">{question}</p>
            <p className="text-[12px] text-text-secondary mt-1 leading-relaxed">{answer}</p>
          </div>
        )) : <p className="text-[13px] text-text-secondary py-6 text-center">Nenhuma pergunta encontrada.</p>)}
        {tab === 'shortcuts' && <ShortcutList />}
      </div>
    </Modal>
  );
}
