export function generateStrongPassword(length = 24) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_@#';
  const getRandomValues =
    typeof window !== 'undefined' && window.crypto?.getRandomValues
      ? (size: number) => {
          const arr = new Uint32Array(size);
          window.crypto.getRandomValues(arr);
          return Array.from(arr);
        }
      : (size: number) => Array.from({ length: size }, () => Math.floor(Math.random() * 0xffffffff));

  const randoms = getRandomValues(length);
  return randoms
    .map((num) => chars[num % chars.length])
    .join('');
}


