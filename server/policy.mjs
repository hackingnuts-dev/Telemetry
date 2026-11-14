export const validPhone = (s) => typeof s === 'string' && /^\+[1-9][0-9]{7,14}$/.test(s);
export const validLocation = (a, b, c) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a) <= 90 &&
  Math.abs(b) <= 180 &&
  (c == null || (Number.isFinite(c) && c >= 0 && c <= 20000));
export function meters(a, b) {
  const r = 6371000,
    d = Math.PI / 180,
    x = (b.lat - a.lat) * d,
    y = (b.lng - a.lng) * d,
    h = Math.sin(x / 2) ** 2 + Math.cos(a.lat * d) * Math.cos(b.lat * d) * Math.sin(y / 2) ** 2;
  return 2 * r * Math.asin(Math.min(1, Math.sqrt(h)));
}
export function canView(subject, viewer, consent) {
  return subject.id === viewer || (!!consent && subject.sharing_enabled === true);
}
