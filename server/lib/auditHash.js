import crypto from 'crypto';

// Hash of an audit entry chained to the previous one. ip/device are excluded:
// retention pseudonymizes them later without breaking the chain.
export function hashAuditEntry(entry, prevHash) {
  const { hash, prevHash: _p, ip: _ip, device: _d, ipTruncated: _t, ...content } = entry;
  return crypto.createHash('sha256').update(`${prevHash}|${JSON.stringify(content)}`).digest('hex');
}
