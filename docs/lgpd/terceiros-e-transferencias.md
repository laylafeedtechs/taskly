# Terceiros, operadores e transferências internacionais

> Levantamento técnico. A qualificação jurídica (operador, controlador conjunto etc.), os contratos
> e o mecanismo de transferência internacional (arts. 33 a 36 da LGPD e regulamentação da ANPD)
> **precisam ser definidos pelo controlador**.

| Serviço | Quando é usado | Dados enviados | Onde processa | Situação atual |
|---|---|---|---|---|
| **Cloudflare (Tunnel)** | Todo acesso pelo link público atual | Todo o tráfego HTTPS (IP, requisições e respostas, inclusive dados pessoais) | Rede global da Cloudflare (inclui EUA) | **Ativo** no ambiente de demonstração. Túnel rápido sem conta nem contrato — adequado só para testes |
| **Google OAuth / OIDC** | Só quando a pessoa escolhe "Continuar com Google" | Redirecionamento do navegador; o servidor troca o código e recebe identificador, nome e e-mail verificado | Google (inclui EUA) | Inativo (credenciais não configuradas) |
| **Provedor SMTP** | Convites, redefinição de senha, verificação, notificações por e-mail | E-mail e nome do destinatário e texto da mensagem | Conforme o provedor escolhido | Inativo (e-mails gravados em `data/outbox/`) |
| **Destinos de webhook** | Configurados por cada workspace | IDs, título, status, prioridade, datas (sem nomes/e-mails/comentários) | Definido pelo workspace | Configurável; bloqueia endereços internos (SSRF) |
| **GitHub (código)** | Hospedagem do repositório | Código-fonte (sem `.env` e sem `data/`, ignorados no git) | GitHub (EUA) | Repositório `Laly-L/Taskly` |

Removidos nesta revisão: **Google Fonts** (chamado em todo carregamento de página) e **imagens do
Unsplash/Google** usadas como avatar — ambos enviavam o IP de cada usuário a terceiros sem
necessidade.

## Antes de ativar um novo serviço

Responder e registrar: que dados vão, por quê, onde são processados, que permissões o serviço recebe,
se ele armazena os dados, por quanto tempo, quais controles de segurança oferece, e qual o mecanismo
de transferência internacional aplicável. Integrações nunca são ativadas automaticamente.
