import { resolveCredential } from '../lib/credentials.js';

export default {
  baseUrl: 'https://api.clockify.me/api/v1',
  get apiKey() {
    return resolveCredential('CLOCKIFY_API_KEY');
  },
};
