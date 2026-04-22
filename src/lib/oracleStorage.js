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

  // Always use .jpg extension — compressGeoImage always produces image/jpeg
  const fileName = `geopost-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;

  const res = await fetch(`${parUrl}${fileName}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: file,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OCI upload failed (${res.status}): ${errText.slice(0, 200)}`);
  }

  // Return the direct public read URL (bucket is public — no PAR token needed to read)
  // PAR format: .../p/<token>/n/<namespace>/b/<bucket>/o/
  const m = parUrl.match(/\/n\/([^/]+)\/b\/([^/]+)\/o\//);
  if (m) {
    return `https://objectstorage.us-ashburn-1.oraclecloud.com/n/${m[1]}/b/${m[2]}/o/${fileName}`;
  }
  // Fallback: use PAR URL + filename (also publicly readable for public buckets)
  return `${parUrl}${fileName}`;
}

/**
 * Returns true if the OCI PAR URL is configured.
 * Used to decide whether to use OCI or Supabase as the image upload backend.
 */
export function isOciConfigured() {
  return !!import.meta.env.VITE_OCI_PAR_URL;
}

