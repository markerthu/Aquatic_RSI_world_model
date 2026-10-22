import { register } from 'node:module';
register(new URL('./no_three_hooks.mjs', import.meta.url).href);
