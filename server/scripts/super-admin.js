// Grants or revokes the Super Admin privilege. This is intentionally only
// possible from the server console, never through the API or the frontend.
//   npm run admin:grant -- pessoa@empresa.com
//   npm run admin:revoke -- pessoa@empresa.com
// Cloudflare (D1): add --remote (production) or --local (wrangler dev):
//   npm run admin:grant -- pessoa@empresa.com --remote
// Node: run with the server stopped (it keeps the database in memory).
const [mode, email] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(mode) || !email || email.startsWith('--')) {
  console.log('Uso: node server/scripts/super-admin.js <grant|revoke> <email> [--remote|--local]');
  process.exit(1);
}
const { db } = await import('../db.js');
const { audit } = await import('../lib/observability.js');
const { revokeUserSessions } = await import('../middleware/auth.js');
const { targetFromArgs, wranglerD1 } = await import('./lib/wrangler-d1.js');

const target = targetFromArgs(process.argv);
if (target) {
  // Same code path as the Worker: load from D1, change, write one guarded batch.
  const { withD1Store } = await import('../lib/d1store.js');
  try {
    console.log(await withD1Store(wranglerD1('taskly', target), apply));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
} else {
  console.log(apply());
}

function apply() {
  const user = db.find('users', u => u.email.toLowerCase() === email.toLowerCase());
  if (!user) { console.error('Usuário não encontrado'); process.exit(1); }
  if (mode === 'revoke' && db.filter('users', u => u.isSuperAdmin).length <= 1 && user.isSuperAdmin) {
    console.error('Não é possível remover o último Super Admin'); process.exit(1);
  }
  user.isSuperAdmin = mode === 'grant';
  revokeUserSessions(user.id); // new privileges only apply to fresh sessions
  audit({ auditActor: `console:${process.env.USERNAME || process.env.USER || 'server'}`, headers: {} }, {
    action: mode === 'grant' ? 'SUPER_ADMIN_GRANTED' : 'SUPER_ADMIN_REVOKED', entity: `Usuário ${user.id}`, category: 'admin'
  });
  db.save();
  return `${user.email}: Super Admin ${mode === 'grant' ? 'concedido' : 'removido'}${target ? ` (D1 ${target.slice(2)})` : ''}. Sessões encerradas.`;
}
