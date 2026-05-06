export const readNumber = (value: unknown) => {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number(rawValue);
  return Number.isFinite(parsed) ? parsed : undefined;
};
