// TOKA GDMS — UUID & Human-Readable Reference Generators

/**
 * Generates an immutable UUIDv4 string for client-side transaction idempotency
 */
export function generateClientTxId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback RFC4122 version 4 compliant generator
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generates a human-readable delivery reference: GD-YYYYMM-XXXX
 */
export function generateDeliveryReference(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `GD-${year}${month}-${random}`;
}

/**
 * Generates a human-readable collection reference: COL-YYYYMM-XXXX
 */
export function generateCollectionReference(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const random = Math.floor(1000 + Math.random() * 9000);
  return `COL-${year}${month}-${random}`;
}
