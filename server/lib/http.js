// Shared HTTP helpers: typed errors, input validation and small utilities.

export class HttpError extends Error {
  constructor(status, message, code = 'ERROR', details = undefined) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
    this.expose = true;
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, 'VALIDATION_ERROR', details);
export const unauthorized = (msg = 'Autenticação necessária') => new HttpError(401, msg, 'UNAUTHENTICATED');
export const forbidden = (msg = 'Você não tem permissão para esta ação') => new HttpError(403, msg, 'FORBIDDEN');
// Inaccessible resources answer 404 so IDs from other workspaces cannot be probed.
export const notFound = (msg = 'Recurso não encontrado') => new HttpError(404, msg, 'NOT_FOUND');
export const conflict = (msg, details) => new HttpError(409, msg, 'CONFLICT', details);

export const PRIORITIES = ['Urgent', 'High', 'Normal', 'Low'];
export const TASK_TYPES = ['Task', 'Bug', 'Feature', 'Improvement', 'Research', 'Meeting'];
export const ROLES = ['Owner', 'Manager', 'Member', 'Viewer'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const v = {
  str(value, field, { min = 0, max = 500, required = false, trim = true } = {}) {
    if (value === undefined || value === null) {
      if (required) throw badRequest(`O campo "${field}" é obrigatório`);
      return undefined;
    }
    if (typeof value !== 'string') throw badRequest(`O campo "${field}" deve ser texto`);
    const s = trim ? value.trim() : value;
    if (required && s.length === 0) throw badRequest(`O campo "${field}" é obrigatório`);
    if (s.length < min) throw badRequest(`O campo "${field}" deve ter ao menos ${min} caracteres`);
    if (s.length > max) throw badRequest(`O campo "${field}" deve ter no máximo ${max} caracteres`);
    return s;
  },
  email(value, field = 'email', { required = true } = {}) {
    const s = v.str(value, field, { max: 254, required });
    if (s === undefined) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) throw badRequest('E-mail inválido');
    return s.toLowerCase();
  },
  password(value, field = 'password') {
    if (typeof value !== 'string' || value.length < 8) throw badRequest('A senha deve ter pelo menos 8 caracteres');
    if (value.length > 128) throw badRequest('A senha deve ter no máximo 128 caracteres');
    return value;
  },
  oneOf(value, field, allowed, { required = false } = {}) {
    if (value === undefined || value === null) {
      if (required) throw badRequest(`O campo "${field}" é obrigatório`);
      return undefined;
    }
    if (!allowed.includes(value)) throw badRequest(`Valor inválido para "${field}"`);
    return value;
  },
  date(value, field) {
    if (value === undefined) return undefined;
    if (value === null || value === '') return null;
    if (typeof value !== 'string' || !DATE_RE.test(value) || Number.isNaN(Date.parse(value))) {
      throw badRequest(`Data inválida em "${field}" (use AAAA-MM-DD)`);
    }
    return value;
  },
  bool(value) {
    return value === undefined ? undefined : Boolean(value);
  },
  int(value, field, { min = -Infinity, max = Infinity } = {}) {
    if (value === undefined || value === null || value === '') return value === undefined ? undefined : null;
    const n = Number(value);
    if (!Number.isInteger(n) || n < min || n > max) throw badRequest(`Número inválido em "${field}"`);
    return n;
  },
  strArray(value, field, { maxItems = 50, maxLen = 60 } = {}) {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) throw badRequest(`O campo "${field}" deve ser uma lista`);
    if (value.length > maxItems) throw badRequest(`Máximo de ${maxItems} itens em "${field}"`);
    return [...new Set(value.map(x => v.str(x, field, { max: maxLen, required: true })))];
  },
  color(value, field = 'color') {
    if (value === undefined) return undefined;
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) throw badRequest(`Cor inválida em "${field}"`);
    return value;
  }
};

export function pick(obj, keys) {
  const out = {};
  keys.forEach(k => { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

export function paginate(list, query, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const limit = Math.min(Math.max(parseInt(query.limit, 10) || defaultLimit, 1), maxLimit);
  const page = Math.max(parseInt(query.page, 10) || 1, 1);
  const total = list.length;
  return {
    items: list.slice((page - 1) * limit, page * limit),
    total,
    page,
    limit,
    totalPages: Math.max(Math.ceil(total / limit), 1)
  };
}

export const today = () => new Date().toISOString().slice(0, 10);

export function clientInfo(req) {
  return { ip: req.ip || req.socket?.remoteAddress || null, device: String(req.headers['user-agent'] || '').slice(0, 200) };
}
