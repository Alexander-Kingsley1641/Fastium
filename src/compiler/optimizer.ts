export const optimizeFastSource = (source: string): string => source
  .replace(/^\uFEFF/u, '')
  .replace(/^#!.*$/m, '')
  .replace(/\r\n/g, '\n')
  .replace(/[ \t]+$/gm, '')
  .replace(/\n{3,}/g, '\n\n')
  .trim();