// Oracle Cloud Infrastructure Object Storage — browser-compatible upload
// Uses Web Crypto API for RSA-SHA256 request signing (OCI HTTP Signature v1)
//
// Required Vite env vars (VITE_ prefix, embedded at build time):
//   VITE_OCI_TENANCY    — ocid1.tenancy.oc1..…
//   VITE_OCI_USER       — ocid1.user.oc1..…
//   VITE_OCI_FINGERPRINT — 7a:90:60:93:…
//   VITE_OCI_PRIVATE_KEY — RSA private key PEM (PKCS#8 or PKCS#1), literal \n allowed
//
// CORS: Your Oracle bucket must have a CORS policy allowing PUT from your site origin.
// In OCI Console → Object Storage → bucket → CORS → add rule:
//   Allowed Origins: https://lapuffcore.github.io (or *)
//   Allowed Methods: PUT, GET, HEAD, OPTIONS
//   Allowed Headers: * (or explicit list)

const OCI_NAMESPACE = 'idfnjqqb9g0p';
const OCI_BUCKET = 'geopost-images';
const OCI_REGION = 'us-ashburn-1';
const OCI_HOST = `objectstorage.${OCI_REGION}.oraclecloud.com`;

// ── ASN.1 helpers for PKCS#1 → PKCS#8 conversion ────────────────────────────

function encLen(len) {
  if (len < 0x80) return [len];
  if (len < 0x100) return [0x81, len];
  return [0x82, (len >> 8) & 0xff, len & 0xff];
}

/**
 * Wraps a PKCS#1 RSA DER key in a PKCS#8 PrivateKeyInfo envelope so that
 * SubtleCrypto can import it.
 */
function pkcs1ToPkcs8(der) {
  const pkcs1 = Array.from(new Uint8Array(der));
  // RSAEncryption OID + NULL
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const version = [0x02, 0x01, 0x00];
  const octetStr = [0x04, ...encLen(pkcs1.length), ...pkcs1];
  const inner = [...version, ...algId, ...octetStr];
  return new Uint8Array([0x30, ...encLen(inner.length), ...inner]).buffer;
}

// ── Key import ───────────────────────────────────────────────────────────────

function getPem() {
  const raw = (import.meta.env.VITE_OCI_PRIVATE_KEY || '').trim();
  // GitHub Secrets store newlines as literal \n — convert them
  return raw.replace(/\\n/g, '\n');
}

async function importPrivateKey() {
  const pem = getPem();
  if (!pem) throw new Error('VITE_OCI_PRIVATE_KEY is not set');

  const isPkcs8 = pem.includes('BEGIN PRIVATE KEY');
  const pemBody = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/, '')
    .replace(/\s/g, '');

  const rawDer = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0)).buffer;
  const derBuffer = isPkcs8 ? rawDer : pkcs1ToPkcs8(rawDer);

  return crypto.subtle.importKey(
    'pkcs8',
    derBuffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// ── Request signing ──────────────────────────────────────────────────────────

async function buildAuthHeader({ method, path, date, contentType, contentLength, bodyHash }) {
  const signingString = [
    `date: ${date}`,
    `(request-target): ${method.toLowerCase()} ${path}`,
    `host: ${OCI_HOST}`,
    `content-type: ${contentType}`,
    `content-length: ${contentLength}`,
    `x-content-sha256: ${bodyHash}`,
  ].join('\n');

  const key = await importPrivateKey();
  const sigBytes = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingString)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBytes)));

  const tenancy = import.meta.env.VITE_OCI_TENANCY;
  const user = import.meta.env.VITE_OCI_USER;
  const fingerprint = import.meta.env.VITE_OCI_FINGERPRINT;
  const keyId = `${tenancy}/${user}/${fingerprint}`;

  return `Signature version="1",headers="date (request-target) host content-type content-length x-content-sha256",keyId="${keyId}",algorithm="rsa-sha256",signature="${sig}"`;
}

// ── Public upload function ────────────────────────────────────────────────────

/**
 * Upload a File/Blob to Oracle Cloud Object Storage.
 * Returns the public URL of the uploaded object.
 *
 * @param {File} file  — The (already-compressed) image file to upload.
 * @returns {Promise<string>}  — Public URL of the stored image.
 */
export async function uploadToOracleCloud(file) {
  const buffer = await file.arrayBuffer();

  // Content hash (x-content-sha256) — OCI requires base64-encoded SHA-256 of the body
  const hashBuf = await crypto.subtle.digest('SHA-256', buffer);
  const bodyHash = btoa(String.fromCharCode(...new Uint8Array(hashBuf)));

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = `geopost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
  const objectPath = `/n/${OCI_NAMESPACE}/b/${OCI_BUCKET}/o/${encodeURIComponent(fileName)}`;

  const date = new Date().toUTCString();
  const contentType = file.type || 'image/jpeg';
  const contentLength = buffer.byteLength;

  const authHeader = await buildAuthHeader({
    method: 'PUT',
    path: objectPath,
    date,
    contentType,
    contentLength,
    bodyHash,
  });

  const res = await fetch(`https://${OCI_HOST}${objectPath}`, {
    method: 'PUT',
    headers: {
      Authorization: authHeader,
      Date: date,
      'Content-Type': contentType,
      'x-content-sha256': bodyHash,
      // Content-Length is set automatically by the browser from the body
    },
    body: buffer,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OCI upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  return `https://objectstorage.${OCI_REGION}.oraclecloud.com/n/${OCI_NAMESPACE}/b/${OCI_BUCKET}/o/${encodeURIComponent(fileName)}`;
}

/**
 * Returns true if OCI env vars are configured.
 * Used to decide whether to use OCI or Supabase as fallback.
 */
export function isOciConfigured() {
  return !!(
    import.meta.env.VITE_OCI_TENANCY &&
    import.meta.env.VITE_OCI_USER &&
    import.meta.env.VITE_OCI_FINGERPRINT &&
    import.meta.env.VITE_OCI_PRIVATE_KEY
  );
}
