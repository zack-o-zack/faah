function isInternalURL(value, origin) {
  try {
    const url = new URL(value);
    return url.origin === origin && !url.username && !url.password;
  } catch {
    return false;
  }
}

function isExternalURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function workbenchURL(origin, target) {
  const url = new URL('/', origin);
  if (target) url.searchParams.set('open', target);
  return url.href;
}

module.exports = { isInternalURL, isExternalURL, workbenchURL };
