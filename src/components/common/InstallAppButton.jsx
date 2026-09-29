import React, { useState } from 'react';
import { useInstallApp } from '../../lib/install';
import { Modal, Btn, Icon } from '../ui';

// "Baixar app": native install prompt when the browser offers one,
// otherwise step-by-step instructions (iPhone/iPad, Firefox, Safari desktop).
export function InstallAppButton({ variant = 'sidebar' }) {
  const { installed, canPrompt, ios, install } = useInstallApp();
  const [help, setHelp] = useState(false);
  if (installed) return null;

  const onClick = async () => {
    if (canPrompt) {
      const outcome = await install();
      if (outcome !== 'unavailable') return;
    }
    setHelp(true);
  };

  const button = variant === 'sidebar' ? (
    <button type="button" onClick={onClick} className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg border border-border bg-surface-card text-[12px] text-text-secondary hover:text-text-primary hover:border-border-focus transition-colors">
      <Icon name="install_desktop" size={17} className="text-blue-400" />
      <span className="flex-1 text-left">
        <span className="block font-medium text-text-primary">Baixar app</span>
        <span className="block text-[11px] text-text-muted">Instale no computador ou celular</span>
      </span>
    </button>
  ) : (
    <Btn icon="install_mobile" onClick={onClick} className="w-full">Baixar o app Taskly</Btn>
  );

  return (
    <>
      {button}
      <Modal open={help} onClose={() => setHelp(false)} title="Instalar o Taskly" size="sm" footer={<Btn variant="primary" onClick={() => setHelp(false)}>Entendi</Btn>}>
        {ios ? (
          <ol className="flex flex-col gap-3 text-[13px] text-text-secondary list-decimal pl-5">
            <li>Abra este site no <strong className="text-text-primary">Safari</strong>.</li>
            <li>Toque em <Icon name="ios_share" size={16} className="align-middle text-text-primary" /> <strong className="text-text-primary">Compartilhar</strong>.</li>
            <li>Escolha <strong className="text-text-primary">Adicionar à Tela de Início</strong> e confirme.</li>
          </ol>
        ) : (
          <div className="flex flex-col gap-3 text-[13px] text-text-secondary">
            <p><strong className="text-text-primary">Chrome ou Edge (computador):</strong> clique no ícone <Icon name="install_desktop" size={16} className="align-middle text-text-primary" /> no fim da barra de endereço, ou no menu ⋮ → <em>Instalar Taskly</em>.</p>
            <p><strong className="text-text-primary">Android:</strong> no Chrome, menu ⋮ → <em>Instalar app</em> (ou <em>Adicionar à tela inicial</em>).</p>
            <p><strong className="text-text-primary">Firefox / Safari no Mac:</strong> use o Chrome ou o Edge para instalar, ou adicione aos favoritos (no Safari do macOS: Arquivo → Adicionar ao Dock).</p>
            <p className="text-[12px] text-text-muted">A instalação só fica disponível quando o site é acessado por HTTPS.</p>
          </div>
        )}
      </Modal>
    </>
  );
}
