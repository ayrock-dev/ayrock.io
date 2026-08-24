import { customAlphabet } from 'nanoid/non-secure';

export const nanoid = customAlphabet(
  '1234567890abcdefghijklmnopqrstuvwxyz',
  10,
);
