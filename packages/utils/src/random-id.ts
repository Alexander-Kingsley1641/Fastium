export const randomID = (prefix = 'ax'): string => {
  const entropy = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}_${entropy}`;
};
