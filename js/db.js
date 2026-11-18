/* The browser talks to LifeLink's same-origin API. It never stores the database. */
const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];

async function api(operation, body = {}, asFile = false) {
  const response = await fetch('/api/' + operation, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(body)
  });
  if (asFile && response.ok) return response.blob();
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error('LifeLink is temporarily unavailable. Please try again.');
  }
  if (!response.ok) throw new Error(data.error || 'LifeLink could not complete this request.');
  return data;
}

async function action(operation, body) {
  try {
    return await api(operation, body);
  } catch (error) {
    return { ok: false, error: error.message || 'LifeLink is temporarily unavailable.' };
  }
}

async function downloadDatabaseFile() {
  const file = await api('adminExport', {}, true);
  const link = document.createElement('a');
  link.href = URL.createObjectURL(file);
  link.download = 'lifelink.sqlite';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}
