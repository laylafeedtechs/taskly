// Grants or revokes the Super Admin privilege. This is intentionally only
// possible from the server console, never through the API or the frontend.
//   npm run admin:grant -- pessoa@empresa.com
//   npm run admin:revoke -- pessoa@empresa.com
// Run with the server stopped (the running server keeps the database in memory).
const [mode, email] = process.argv.slice(2);
if (!['grant', 'revoke'].includes(mode) || !email) {
  console.log('Uso: node server/scripts/super-admin.js <grant|revoke> <email>');
  process.exit(1);
}
const { db } = await import('../db.js');
const { audit } = await import('../lib/observability.js');
const { revokeUserSessions } = await import('../middleware/auth.js');

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
console.log(`${user.email}: Super Admin ${mode === 'grant' ? 'concedido' : 'removido'}. Sessões encerradas.`);
