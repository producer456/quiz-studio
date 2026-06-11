// Shared helpers. These existed as per-file copies that drifted (the unchunked
// base64 copy in generate.js threw RangeError on normal-size images).

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
}

export function safeFileName(name) {
  return String(name).toLowerCase().replace(/[^a-z0-9._-]/g, '_');
}

// Uint8Array/ArrayBuffer → base64, chunked to stay under engine argument limits.
export function toBase64(bytes) {
  if (bytes instanceof ArrayBuffer) bytes = new Uint8Array(bytes);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// Canonical question-id format, shared by the generator, Marcus renumbering,
// and manual authoring so they can't drift.
export function questionId(n) {
  return `q${String(n).padStart(3, '0')}`;
}

export function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
