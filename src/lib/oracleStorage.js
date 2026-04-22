// Oracle Cloud Infrastructure Object Storage — PAR (Pre-Authenticated Request) upload
//
// Required Vite env var (embed at build time OR set in GitHub Secrets as VITE_OCI_PAR_URL):
//   VITE_OCI_PAR_URL — Bucket-level PAR URL ending with /o/
//   e.g. https://objectstorage.us-ashburn-1.oraclecloud.com/p/<token>/n/<ns>/b/<bucket>/o/
//
// No OCI SDK, no request signing, no CORS preflight issues.
// The PAR URL itself carries all auth. Just PUT to PAR_URL + filename.

/**
 * Upload a File/Blob to Oracle Cloud Object Storage via a bucket-level PAR.
 * Returns the public URL of the uploaded object.
 *
 * @param {File} file — The (already-compressed) image file to upload.
 * @returns {Promise<string>} — Public URL of the stored image.
 */
export async function uploadToOracleCloud(file) {
  const parUrl = import.meta.env.VITE_OCI_PAR_URL;
  if (!parUrl) throw new Error('VITE_OCI_PAR_URL is not configured');

  const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
  const fileName = `geopost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;

  const res = await fetch(`${parUrl}${fileName}`, {
    method: 'PUT',
    headers: { 'Content-Type': file.type || 'image/jpeg' },
    body: file,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OCI upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  // Derive the public URL from the PAR path — extract namespace and bucket from the PAR URL
  // PAR format: .../p/<token>/n/<namespace>/b/<bucket>/o/
  const m = parUrl.match(/\/n\/([^/]+)\/b\/([^/]+)\/o\//);
  if (m) {
    return `https://objectstorage.us-ashburn-1.oraclecloud.com/n/${m[1]}/b/${m[2]}/o/${encodeURIComponent(fileName)}`;
  }
  // Fallback: PAR URL itself + filename is also publicly accessible
  return `${parUrl}${encodeURIComponent(fileName)}`;
}

/**
 * Returns true if the OCI PAR URL is configured.
 * Used to decide whether to use OCI or Supabase as the image upload backend.
 */
export function isOciConfigured() {
  return !!import.meta.env.VITE_OCI_PAR_URL;
}

